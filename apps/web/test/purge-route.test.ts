import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDiskProvider, createSession } from "@repo/core";
import { disconnectAll } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleProductPurge } from "../src/server/handlers/product-purge";

const ROOT = "localhost:3000";
let dir: string;
let disk: LocalDiskProvider;
type Ctx = { storeId: string; host: string; owner: string; staff: string };
let A: Ctx;
let B: Ctx;

async function setup(label: string): Promise<Ctx> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const store = await adminClient().store.create({
    data: {
      nameBn: label,
      nameEn: label,
      subdomain: `t-purge-${label}-${suffix}`,
      status: "ACTIVE",
      settings: { create: { onboardingStep: 4, onboardingCompletedAt: new Date() } },
      users: {
        create: [
          { name: "Owner", role: "OWNER", phone: `+88017${Math.floor(10000000 + Math.random() * 89999999)}` },
          { name: "Staff", role: "STAFF", phone: `+88018${Math.floor(10000000 + Math.random() * 89999999)}` },
        ],
      },
    },
    include: { users: true },
  });
  return {
    storeId: store.id,
    host: `${store.subdomain}.${ROOT}`,
    owner: (await createSession(store.id, store.users.find((u) => u.role === "OWNER")!)).token,
    staff: (await createSession(store.id, store.users.find((u) => u.role === "STAFF")!)).token,
  };
}

/** A trashed product with one image (objects on disk). */
async function trashedProduct(ctx: Ctx) {
  const id = Math.random().toString(36).slice(2, 10);
  const key = `stores/${ctx.storeId}/product/${id}.webp`;
  const thumbKey = `stores/${ctx.storeId}/product/thumb/${id}.webp`;
  await disk.put(key, Buffer.from("img"));
  await disk.put(thumbKey, Buffer.from("thumb"));
  const p = await adminClient().product.create({
    data: {
      storeId: ctx.storeId,
      titleBn: "প",
      titleEn: "P",
      slug: `p-${id}`,
      deletedAt: new Date(),
      images: {
        create: { storeId: ctx.storeId, key, thumbKey, url: "u", thumbUrl: "t", width: 1, height: 1 },
      },
    },
  });
  return { id: p.id, keys: [key, thumbKey] };
}

async function purge(ctx: Ctx, ids: string[], opts: { token?: string; origin?: string | null } = {}) {
  const form = new FormData();
  for (const id of ids) form.append("ids", id);
  const headers: Record<string, string> = { host: ctx.host };
  if (opts.origin !== null) headers.origin = opts.origin ?? `http://${ctx.host}`;
  if (opts.token) headers.cookie = `ec_session=${opts.token}`;
  const res = await handleProductPurge(
    new Request(`http://${ctx.host}/api/admin/products/purge`, { method: "POST", headers, body: form }),
    { translate: async (_l, code) => code, rootDomain: ROOT, storage: disk },
  );
  return { status: res.status, location: res.headers.get("location") };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ec-purge-"));
  disk = new LocalDiskProvider({ root: dir });
  A = await setup("a");
  B = await setup("b");
});

afterAll(async () => {
  await adminClient().store.deleteMany({ where: { id: { in: [A.storeId, B.storeId] } } });
  await rm(dir, { recursive: true, force: true });
  await disconnectAll();
});

describe("POST /api/admin/products/purge", () => {
  it("is OWNER only (STAFF → 403), same-origin only, session required; nothing is deleted on refusal", async () => {
    const p = await trashedProduct(A);
    expect(await purge(A, [p.id], { token: A.staff })).toMatchObject({ status: 403 });
    expect(await purge(A, [p.id], { token: A.owner, origin: "http://evil.example" })).toMatchObject({
      status: 403,
    });
    expect(await purge(A, [p.id], { token: A.owner, origin: null })).toMatchObject({ status: 403 });
    expect(await purge(A, [p.id])).toMatchObject({ status: 401 });
    expect(await purge(A, [p.id], { token: B.owner })).toMatchObject({ status: 401 }); // store B's cookie
    expect(await adminClient().product.count({ where: { id: p.id } })).toBe(1);
    for (const k of p.keys) expect(await disk.read(k)).not.toBeNull();
  });

  it("OWNER: deletes rows and image objects, redirects back to the trash; other stores' ids are ignored", async () => {
    const mine = await trashedProduct(A);
    const theirs = await trashedProduct(B);
    expect(await purge(A, [mine.id, theirs.id], { token: A.owner })).toEqual({
      status: 303,
      location: "/admin/products/trash?deleted=1",
    });
    expect(await adminClient().product.count({ where: { id: mine.id } })).toBe(0);
    for (const k of mine.keys) expect(await disk.read(k)).toBeNull();
    expect(await adminClient().product.count({ where: { id: theirs.id } })).toBe(1);
    for (const k of theirs.keys) expect(await disk.read(k)).not.toBeNull();
    expect(await purge(A, [], { token: A.owner })).toMatchObject({ status: 400 });
  });
});
