import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { disconnectAll } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { mockClient } from "aws-sdk-client-mock";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ForeignKeyError,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  ImageUploadError,
  assertStoreKey,
  detectImageType,
  processAndStoreImage,
  saveStoreLogo,
} from "../src/images";
import { LocalDiskProvider, S3CompatibleProvider, createStorageProvider } from "../src/storage";
import { createTestStore, deleteStores } from "./helpers";

let dir: string;
let disk: LocalDiskProvider;
let storeA: { id: string };
let storeB: { id: string };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ec-uploads-"));
  disk = new LocalDiskProvider({ root: dir });
  storeA = await createTestStore("up-a");
  storeB = await createTestStore("up-b");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await deleteStores(storeA.id, storeB.id);
  await disconnectAll();
});

afterEach(() => vi.unstubAllEnvs());

const solid = (width: number, height: number, color = { r: 200, g: 30, b: 60 }) =>
  sharp({ create: { width, height, channels: 3, background: color } });

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImageUploadError);
  expect((error as ImageUploadError).code).toBe(code);
};

const fileExists = (key: string) => existsSync(path.join(dir, ...key.split("/")));

describe("image validation", () => {
  it("detects types by magic bytes only", async () => {
    expect(detectImageType(await solid(10, 10).png().toBuffer())).toBe("image/png");
    expect(detectImageType(await solid(10, 10).jpeg().toBuffer())).toBe("image/jpeg");
    expect(detectImageType(await solid(10, 10).webp().toBuffer())).toBe("image/webp");
    expect(detectImageType(Buffer.from("hello, I am a .png"))).toBeNull();
  });

  it("rejects a text file renamed to .png", async () => {
    await expectCode(
      processAndStoreImage("logo", {
        storeId: storeA.id,
        data: Buffer.from("not an image\n".repeat(50)),
        storage: disk,
      }),
      "UPLOAD_TYPE",
    );
  });

  it("rejects files over 5 MB", async () => {
    const big = Buffer.alloc(IMAGE_MAX_BYTES + 1);
    (await solid(10, 10).png().toBuffer()).copy(big); // valid PNG signature, too large
    await expectCode(
      processAndStoreImage("logo", { storeId: storeA.id, data: big, storage: disk }),
      "UPLOAD_TOO_LARGE",
    );
  });

  it(`rejects images over ${IMAGE_MAX_PIXELS / 1e6} megapixels, even when the file is small`, async () => {
    // 50 MP solid PNG: ~160 KB on disk, ~150 MB decoded.
    const bomb = await solid(7072, 7072).png().toBuffer();
    expect(bomb.length).toBeLessThan(IMAGE_MAX_BYTES);
    await expectCode(
      processAndStoreImage("logo", { storeId: storeA.id, data: bomb, storage: disk }),
      "UPLOAD_TOO_LARGE",
    );
    // Just under the limit is fine.
    const ok = await solid(6000, 6000).png().toBuffer();
    const stored = await processAndStoreImage("logo", { storeId: storeA.id, data: ok, storage: disk });
    expect(stored.variants.logo.width).toBe(512);
  });

  it("rejects images smaller than 128 px and corrupt images", async () => {
    const small = await solid(300, 100).png().toBuffer();
    await expectCode(
      processAndStoreImage("logo", { storeId: storeA.id, data: small, storage: disk }),
      "UPLOAD_TOO_SMALL",
    );
    const truncated = (await solid(300, 300).png().toBuffer()).subarray(0, 40);
    await expectCode(
      processAndStoreImage("logo", { storeId: storeA.id, data: truncated, storage: disk }),
      "UPLOAD_INVALID",
    );
  });
});

describe("processAndStoreImage('logo')", () => {
  it("makes a ≤512 px WebP logo and a 64×64 PNG favicon, strips EXIF, suggests a colour", async () => {
    const jpeg = await solid(1200, 800)
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner", Artist: "GPS lives here" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const result = await processAndStoreImage("logo", { storeId: storeA.id, data: jpeg, storage: disk });
    const { logo, favicon } = result.variants;
    expect(logo.key).toMatch(new RegExp(`^stores/${storeA.id}/logo/[a-z0-9]+\\.webp$`));
    expect(favicon.key).toMatch(new RegExp(`^stores/${storeA.id}/favicon/[a-z0-9]+\\.png$`));
    expect(logo.url).toBe(`/api/uploads/${logo.key}`);
    expect([logo.width, logo.height]).toEqual([512, 341]);
    expect([favicon.width, favicon.height]).toEqual([64, 64]);

    const stored = await disk.read(logo.key);
    const meta = await sharp(stored!).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(stored!.includes(Buffer.from("secret-owner"))).toBe(false);
    expect((await sharp((await disk.read(favicon.key))!).metadata()).exif).toBeUndefined();

    expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("applies EXIF orientation before checking size", async () => {
    // 400×150 stored, rotated 90° on display → 150×400: still ≥128 on both sides.
    const rotated = await solid(400, 150).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processAndStoreImage("logo", { storeId: storeA.id, data: rotated, storage: disk });
    expect(result.variants.logo.height).toBeGreaterThan(result.variants.logo.width);
  });
});

describe("saveStoreLogo", () => {
  it("rejects keys outside the store's own prefix", async () => {
    const own = await processAndStoreImage("logo", {
      storeId: storeA.id,
      data: await solid(200, 200).png().toBuffer(),
      storage: disk,
    });
    const foreign = { ...own.variants.logo, key: `stores/${storeB.id}/logo/x.webp` };
    await expect(
      saveStoreLogo(storeA.id, { logo: foreign, favicon: own.variants.favicon }, disk),
    ).rejects.toBeInstanceOf(ForeignKeyError);
    expect(() =>
      assertStoreKey(storeA.id, `stores/${storeA.id}/logo/../../${storeB.id}/logo/x.webp`, "logo"),
    ).toThrow(ForeignKeyError);
    expect(() => assertStoreKey(storeA.id, `stores/${storeA.id}/favicon/x.png`, "logo")).toThrow(
      ForeignKeyError,
    );
  });

  it("saves keys + URLs and deletes the previous logo and favicon on replace", async () => {
    const first = await processAndStoreImage("logo", {
      storeId: storeA.id,
      data: await solid(300, 300).png().toBuffer(),
      storage: disk,
    });
    await saveStoreLogo(storeA.id, first.variants, disk);

    const second = await processAndStoreImage("logo", {
      storeId: storeA.id,
      data: await solid(300, 300, { r: 10, g: 120, b: 200 }).webp().toBuffer(),
      storage: disk,
    });
    const { deleted } = await saveStoreLogo(storeA.id, second.variants, disk);

    expect(deleted.sort()).toEqual([first.variants.logo.key, first.variants.favicon.key].sort());
    expect(fileExists(first.variants.logo.key)).toBe(false);
    expect(fileExists(first.variants.favicon.key)).toBe(false);
    expect(fileExists(second.variants.logo.key)).toBe(true);

    const settings = await adminClient().storeSettings.findUniqueOrThrow({ where: { storeId: storeA.id } });
    expect(settings).toMatchObject({
      logoKey: second.variants.logo.key,
      logoUrl: second.variants.logo.url,
      faviconKey: second.variants.favicon.key,
      faviconUrl: second.variants.favicon.url,
    });
  });

  it("keeps the new logo even if deleting the old one fails", async () => {
    const first = await processAndStoreImage("logo", {
      storeId: storeA.id,
      data: await solid(200, 200).png().toBuffer(),
      storage: disk,
    });
    await saveStoreLogo(storeA.id, first.variants, disk);
    const flaky = Object.assign(Object.create(disk) as LocalDiskProvider, {
      delete: () => Promise.reject(new Error("network down")),
    });
    const next = await processAndStoreImage("logo", {
      storeId: storeA.id,
      data: await solid(200, 200).png().toBuffer(),
      storage: disk,
    });
    expect(await saveStoreLogo(storeA.id, next.variants, flaky)).toEqual({ deleted: [] });
    const settings = await adminClient().storeSettings.findUniqueOrThrow({ where: { storeId: storeA.id } });
    expect(settings.logoKey).toBe(next.variants.logo.key);
  });
});

describe("storage providers", () => {
  it("LocalDiskProvider refuses keys that escape its root", async () => {
    await expect(disk.put("../evil.txt", Buffer.from("x"))).rejects.toThrow(/Unsafe storage key/);
    expect(await disk.read("../../etc/passwd")).toBeNull();
  });

  it("S3CompatibleProvider sends Put/Delete with content type and cache control (mocked)", async () => {
    const s3 = mockClient(S3Client);
    s3.on(PutObjectCommand).resolves({});
    s3.on(DeleteObjectCommand).resolves({});
    const provider = new S3CompatibleProvider(
      {
        endpoint: "https://example.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "assets",
        accessKeyId: "id",
        secretAccessKey: "secret",
        forcePathStyle: false,
        publicBaseUrl: "https://cdn.example.com/",
      },
      new S3Client({ region: "auto" }),
    );
    const png = await solid(256, 256).png().toBuffer();
    const result = await processAndStoreImage("logo", { storeId: storeA.id, data: png, storage: provider });

    const puts = s3.commandCalls(PutObjectCommand).map((c) => c.args[0].input);
    expect(puts).toHaveLength(2);
    expect(puts[0]).toMatchObject({
      Bucket: "assets",
      Key: result.variants.logo.key,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    });
    expect(puts[0]).not.toHaveProperty("ACL");
    expect(result.variants.favicon.url).toBe(`https://cdn.example.com/${result.variants.favicon.key}`);

    await provider.delete(result.variants.logo.key);
    expect(s3.commandCalls(DeleteObjectCommand)[0]?.args[0].input).toEqual({
      Bucket: "assets",
      Key: result.variants.logo.key,
    });
    s3.restore();
  });

  it("refuses local disk storage in a real production deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createStorageProvider({ STORAGE_PROVIDER: "local", ROOT_DOMAIN: "easycommerce.com.bd" }),
    ).toThrow(/refusing to run in production/);
    // `next start` on a developer machine.
    expect(createStorageProvider({ STORAGE_PROVIDER: "local", ROOT_DOMAIN: "localhost:3000" }).kind).toBe(
      "local",
    );
    expect(() => createStorageProvider({ ROOT_DOMAIN: "easycommerce.com.bd" })).toThrow(
      /STORAGE_PROVIDER must be/,
    );
    expect(() => createStorageProvider({ STORAGE_PROVIDER: "s3" })).toThrow(/requires S3_ENDPOINT/);
  });
});

/** Opt-in: runs only when real S3_* credentials are configured. Never in CI by default. */
const live = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "ASSET_PUBLIC_BASE_URL",
].every((k) => process.env[k]);
describe.skipIf(!live)("live S3-compatible upload (opt-in)", () => {
  it("uploads and deletes one object", async () => {
    const provider = S3CompatibleProvider.fromEnv();
    const key = `stores/livetest/logo/${Date.now()}.webp`;
    await provider.put(key, await solid(128, 128).webp().toBuffer(), "image/webp", "no-store");
    const res = await fetch(provider.publicUrl(key));
    expect(res.ok).toBe(true);
    await provider.delete(key);
  });
});
