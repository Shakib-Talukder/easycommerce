import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDiskProvider, createSession } from "@repo/core";
import { disconnectAll, forStore } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import type Sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleProductImageUpload } from "../src/server/handlers/product-image-upload";

// sharp is a dependency of @repo/core, not of the web app.
const sharp = createRequire(path.resolve(import.meta.dirname, "../../../packages/core/package.json"))(
  "sharp",
) as typeof Sharp;

const ROOT = "localhost:3000";
let dir: string;
let disk: LocalDiskProvider;
type Ctx = {
  store: { id: string; subdomain: string };
  host: string;
  owner: string;
  staff: string;
  productId: string;
};
let A: Ctx;
let B: Ctx;

async function setup(label: string): Promise<Ctx> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const store = await adminClient().store.create({
    data: {
      nameBn: label,
      nameEn: label,
      subdomain: `t-up-${label}-${suffix}`,
      status: "ACTIVE",
      settings: { create: { onboardingStep: 4, onboardingCompletedAt: new Date() } },
      users: {
        create: [
          { name: "Owner", role: "OWNER", phone: `+88017${Math.floor(10000000 + Math.random() * 89999999)}` },
          { name: "Staff", role: "STAFF", phone: `+88018${Math.floor(10000000 + Math.random() * 89999999)}` },
        ],
      },
      products: { create: { titleBn: "প", titleEn: "P", slug: "p" } },
    },
    include: { users: true, products: true },
  });
  const owner = store.users.find((u) => u.role === "OWNER")!;
  const staff = store.users.find((u) => u.role === "STAFF")!;
  return {
    store,
    host: `${store.subdomain}.${ROOT}`,
    owner: (await createSession(store.id, owner)).token,
    staff: (await createSession(store.id, staff)).token,
    productId: store.products[0]!.id,
  };
}

const translate = async (_locale: string, code: string, values?: Record<string, number>) =>
  values ? `${code}:${JSON.stringify(values)}` : code;

async function upload(
  ctx: Ctx,
  opts: {
    token?: string;
    origin?: string | null;
    body?: Buffer;
    productId?: string;
    contentLength?: string;
  } = {},
) {
  const form = new FormData();
  if (opts.body)
    form.set("file", new File([new Uint8Array(opts.body)], "photo.webp", { type: "image/webp" }));
  const headers: Record<string, string> = { host: ctx.host };
  if (opts.origin !== null) headers.origin = opts.origin ?? `http://${ctx.host}`;
  if (opts.token) headers.cookie = `ec_session=${opts.token}`;
  if (opts.contentLength) headers["content-length"] = opts.contentLength;
  const request = new Request(`http://${ctx.host}/api/admin/products/x/images`, {
    method: "POST",
    headers,
    body: form,
  });
  const res = await handleProductImageUpload(request, opts.productId ?? ctx.productId, {
    translate,
    rootDomain: ROOT,
    storage: disk,
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; code?: string; message?: string } };
}

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ec-upload-route-"));
  disk = new LocalDiskProvider({ root: dir });
  A = await setup("a");
  B = await setup("b");
});

afterAll(async () => {
  await adminClient().store.deleteMany({ where: { id: { in: [A.store.id, B.store.id] } } });
  await rm(dir, { recursive: true, force: true });
  await disconnectAll();
});

describe("POST /api/admin/products/:id/images", () => {
  it("requires a same-origin Origin header", async () => {
    const body = await photo(400, 400);
    expect(await upload(A, { token: A.owner, origin: null, body })).toMatchObject({
      status: 403,
      body: { code: "FORBIDDEN" },
    });
    expect(await upload(A, { token: A.owner, origin: "http://evil.example", body })).toMatchObject({
      status: 403,
    });
    expect(await upload(A, { token: A.owner, origin: `http://${B.host}`, body })).toMatchObject({
      status: 403,
    });
  });

  it("requires a session for this store", async () => {
    const body = await photo(400, 400);
    expect(await upload(A, { body })).toMatchObject({ status: 401, body: { code: "UNAUTHENTICATED" } });
    // Store B's cookie sent to store A's host.
    expect(await upload(A, { token: B.owner, body })).toMatchObject({ status: 401 });
  });

  it("rejects another store's product, unknown hosts, non-images, tiny and oversized uploads", async () => {
    expect(
      await upload(A, { token: A.owner, body: await photo(400, 400), productId: B.productId }),
    ).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
    const unknown = { ...A, host: `no-such-store.${ROOT}` };
    expect(await upload(unknown, { token: A.owner, body: await photo(400, 400) })).toMatchObject({
      status: 404,
    });
    expect(await upload(A, { token: A.owner, body: Buffer.from("not an image at all") })).toMatchObject({
      status: 415,
      body: { code: "UPLOAD_TYPE" },
    });
    expect(await upload(A, { token: A.owner, body: await photo(250, 250) })).toMatchObject({
      status: 422,
      body: { code: "UPLOAD_TOO_SMALL", message: 'UPLOAD_TOO_SMALL:{"min":300}' },
    });
    expect(
      await upload(A, {
        token: A.owner,
        body: await photo(400, 400),
        contentLength: String(7 * 1024 * 1024),
      }),
    ).toMatchObject({
      status: 413,
    });
    expect(await upload(A, { token: A.owner })).toMatchObject({
      status: 400,
      body: { code: "UPLOAD_MISSING" },
    });
  });

  it("stores the photo (OWNER or STAFF) and enforces 10 per product", async () => {
    const first = await upload(A, { token: A.owner, body: await photo(1200, 900) });
    expect(first).toMatchObject({ status: 201, body: { ok: true } });
    const staff = await upload(A, { token: A.staff, body: await photo(800, 800) });
    expect(staff.status).toBe(201);
    const rows = await forStore(A.store.id).productImage.findMany({ where: { productId: A.productId } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.key.startsWith(`stores/${A.store.id}/product/`)).toBe(true);
      expect(await disk.read(r.key)).not.toBeNull();
      expect(await disk.read(r.thumbKey)).not.toBeNull();
    }
    // Fill up to 10, then the 11th is refused and leaves no objects behind.
    for (let i = rows.length; i < 10; i++) {
      await forStore(A.store.id).productImage.create({
        data: {
          storeId: A.store.id,
          productId: A.productId,
          key: `stores/${A.store.id}/product/fill${i}.webp`,
          thumbKey: `stores/${A.store.id}/product/thumb/fill${i}.webp`,
          url: "u",
          thumbUrl: "t",
          width: 1,
          height: 1,
          sortOrder: i,
        },
      });
    }
    const before = (await Array.fromAsync(disk.list("stores/"))).length;
    expect(await upload(A, { token: A.owner, body: await photo(500, 500) })).toMatchObject({
      status: 409,
      body: { code: "IMAGE_LIMIT" },
    });
    expect((await Array.fromAsync(disk.list("stores/"))).length).toBe(before);
  });
});
