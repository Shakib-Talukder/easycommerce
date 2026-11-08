import { mkdtemp, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createId } from "@paralleldrive/cuid2";
import { disconnectAll } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDiskProvider, S3CompatibleProvider } from "../src/storage";
import { sweepOrphans } from "../src/storage/sweep";
import { createTestStore, deleteStores } from "./helpers";

let dir: string;
let disk: LocalDiskProvider;
let store: { id: string };
const DAY = 24 * 3600 * 1000;

/** Writes a file under the disk root with a given age. */
async function plant(key: string, ageMs: number) {
  const file = path.join(dir, ...key.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "x");
  const t = new Date(Date.now() - ageMs);
  await utimes(file, t, t);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ec-sweep-"));
  disk = new LocalDiskProvider({ root: dir });
  store = await createTestStore("sweep");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await deleteStores(store.id);
  await disconnectAll();
});

describe("storage sweep (LocalDiskProvider + database references)", () => {
  it("lists only old unreferenced objects and objects of deleted stores; --apply deletes only those", async () => {
    const logo = `stores/${store.id}/logo/${createId()}.webp`;
    const favicon = `stores/${store.id}/favicon/${createId()}.png`;
    const orphan = `stores/${store.id}/logo/${createId()}.webp`;
    const fresh = `stores/${store.id}/logo/${createId()}.webp`;
    const gone = `stores/${createId()}/logo/${createId()}.webp`; // no such store
    const goneFresh = `stores/${createId()}/favicon/${createId()}.png`;
    await plant(logo, 3 * DAY);
    await plant(favicon, 3 * DAY);
    await plant(orphan, 2 * DAY);
    await plant(fresh, 60 * 1000);
    await plant(gone, 2 * DAY);
    await plant(goneFresh, 1000);
    await plant("other/readme.txt", 5 * DAY); // outside stores/: ignored
    await adminClient().storeSettings.update({
      where: { storeId: store.id },
      data: {
        logoKey: logo,
        logoUrl: disk.publicUrl(logo),
        faviconKey: favicon,
        faviconUrl: disk.publicUrl(favicon),
      },
    });

    // Only this test's store and files matter; other stores' references don't change the outcome.
    const dry = await sweepOrphans({ storage: disk });
    expect(dry.orphans.map((o) => [o.key, o.reason]).sort()).toEqual(
      [
        [orphan, "UNREFERENCED"],
        [gone, "DELETED_STORE"],
      ].sort(),
    );
    expect(dry).toMatchObject({ scanned: 6, referenced: 2, tooRecent: 2, deleted: [] });
    expect(await disk.read(orphan)).not.toBeNull(); // dry run deletes nothing

    const applied = await sweepOrphans({ storage: disk, apply: true });
    expect(applied.deleted.sort()).toEqual([orphan, gone].sort());
    for (const k of [orphan, gone]) expect(await disk.read(k)).toBeNull();
    for (const k of [logo, favicon, fresh, goneFresh, "other/readme.txt"])
      expect(await disk.read(k)).not.toBeNull();

    expect((await sweepOrphans({ storage: disk })).orphans).toEqual([]);
  });

  it("honours a custom minimum age", async () => {
    const recent = `stores/${store.id}/logo/${createId()}.webp`;
    await plant(recent, 2 * 3600 * 1000);
    const r = await sweepOrphans({ storage: disk, minAgeMs: 3600 * 1000 });
    expect(r.orphans.map((o) => o.key)).toContain(recent);
  });
});

describe("sweep references for the catalogue", () => {
  it("never lists or deletes category images or product images/thumbs, even of soft-deleted products", async () => {
    const cat = `stores/${store.id}/category/${createId()}.webp`;
    const img = `stores/${store.id}/product/${createId()}.webp`;
    const thumb = `stores/${store.id}/product/thumb/${createId()}.webp`;
    const loose = `stores/${store.id}/product/${createId()}.webp`;
    for (const k of [cat, img, thumb, loose]) await plant(k, 3 * DAY);
    const db = adminClient();
    await db.category.create({
      data: {
        storeId: store.id,
        nameBn: "ক",
        nameEn: "Cat",
        slug: `c-${createId().slice(0, 6)}`,
        imageKey: cat,
        imageUrl: disk.publicUrl(cat),
      },
    });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        titleBn: "প",
        titleEn: "P",
        slug: `p-${createId().slice(0, 6)}`,
        deletedAt: new Date(),
      },
    });
    await db.productImage.create({
      data: {
        storeId: store.id,
        productId: product.id,
        key: img,
        thumbKey: thumb,
        url: disk.publicUrl(img),
        thumbUrl: disk.publicUrl(thumb),
        width: 1600,
        height: 1600,
      },
    });

    const result = await sweepOrphans({ storage: disk, apply: true });
    expect(result.deleted).toContain(loose);
    for (const k of [cat, img, thumb]) {
      expect(result.orphans.map((o) => o.key)).not.toContain(k);
      expect(await disk.read(k)).not.toBeNull();
    }
  });
});

describe("storage listing", () => {
  it("LocalDiskProvider.open streams a file without reading it whole, and rejects unsafe keys", async () => {
    const key = `stores/${store.id}/logo/${createId()}.webp`;
    await disk.put(key, Buffer.from("hello"));
    const file = await disk.open(key);
    expect(file?.size).toBe(5);
    const chunks: Buffer[] = [];
    for await (const c of file!.stream()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("hello");
    expect(await disk.open("../etc/passwd")).toBeNull();
    expect(await disk.open(`stores/${store.id}/logo`)).toBeNull(); // a directory
    expect(await disk.open(`stores/${store.id}/logo/missing.webp`)).toBeNull();
  });

  it("S3CompatibleProvider.list follows continuation tokens (mocked)", async () => {
    const s3 = mockClient(S3Client);
    s3.on(ListObjectsV2Command, { ContinuationToken: undefined }).resolves({
      Contents: [{ Key: "stores/a/logo/1.webp", Size: 10, LastModified: new Date(0) }],
      IsTruncated: true,
      NextContinuationToken: "t2",
    });
    s3.on(ListObjectsV2Command, { ContinuationToken: "t2" }).resolves({
      Contents: [{ Key: "stores/b/favicon/2.png", Size: 20, LastModified: new Date(1000) }],
      IsTruncated: false,
    });
    const provider = new S3CompatibleProvider(
      {
        endpoint: "https://example.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "assets",
        accessKeyId: "id",
        secretAccessKey: "secret",
        forcePathStyle: false,
        publicBaseUrl: "https://cdn.example.com",
      },
      new S3Client({ region: "auto" }),
    );
    const keys = [];
    for await (const o of provider.list("stores/")) keys.push(o.key);
    expect(keys).toEqual(["stores/a/logo/1.webp", "stores/b/favicon/2.png"]);
    expect(s3.commandCalls(ListObjectsV2Command).map((c) => c.args[0].input.Prefix)).toEqual([
      "stores/",
      "stores/",
    ]);

    // The sweep works the same against S3 (references injected).
    const r = await sweepOrphans({
      storage: provider,
      references: { keys: ["stores/a/logo/1.webp"], storeIds: ["a"] },
      now: new Date(10 * DAY),
    });
    expect(r.orphans.map((o) => [o.key, o.reason])).toEqual([["stores/b/favicon/2.png", "DELETED_STORE"]]);
    s3.restore();
  });
});
