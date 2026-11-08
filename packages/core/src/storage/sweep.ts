import { adminClient } from "@repo/db/admin";
import type { StorageProvider, StoredObject } from "./types";

/**
 * Orphan sweep for object storage. An object under stores/<storeId>/ is an
 * orphan when it is older than `minAgeMs` (default 24 h) and either
 *   - its store no longer exists, or
 *   - nothing references it (store logo/favicon, category image, product image/thumb).
 * Younger objects are always kept, so an upload whose database save is still in
 * flight is never touched. Objects outside stores/ are ignored.
 *
 * Uses the BYPASSRLS admin role: the sweep is platform tooling and must see
 * every store's references at once.
 */

export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const PREFIX = "stores/";

export type SweepOptions = {
  storage: StorageProvider;
  /** Delete the orphans. Default false (dry run: list only). */
  apply?: boolean;
  minAgeMs?: number;
  now?: Date;
  /** Referenced keys and live store ids; loaded from the database when omitted (tests inject them). */
  references?: { keys: Iterable<string>; storeIds: Iterable<string> };
};

export type SweepOrphan = StoredObject & { reason: "DELETED_STORE" | "UNREFERENCED" };

export type SweepResult = {
  scanned: number;
  referenced: number;
  /** Unreferenced but younger than minAgeMs. */
  tooRecent: number;
  orphans: SweepOrphan[];
  deleted: string[];
  failed: { key: string; error: string }[];
};

/**
 * Every key a store currently points at, plus the ids of existing stores: logo and
 * favicon, category images, and product images + thumbs. Rows of soft-deleted
 * products and categories still count (they can be restored from the trash) until
 * they are permanently deleted.
 */
export async function loadStorageReferences(): Promise<{ keys: Set<string>; storeIds: Set<string> }> {
  const db = adminClient();
  const [stores, settings, categories, images] = await Promise.all([
    db.store.findMany({ select: { id: true } }),
    db.storeSettings.findMany({ select: { logoKey: true, faviconKey: true } }),
    db.category.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } }),
    db.productImage.findMany({ select: { key: true, thumbKey: true } }),
  ]);
  const keys = new Set<string>();
  const add = (k: string | null) => {
    if (k) keys.add(k);
  };
  for (const s of settings) {
    add(s.logoKey);
    add(s.faviconKey);
  }
  for (const c of categories) add(c.imageKey);
  for (const i of images) {
    add(i.key);
    add(i.thumbKey);
  }
  return { keys, storeIds: new Set(stores.map((s) => s.id)) };
}

export async function sweepOrphans(options: SweepOptions): Promise<SweepResult> {
  const { storage, apply = false, minAgeMs = SWEEP_MIN_AGE_MS } = options;
  const now = options.now ?? new Date();
  const refs = options.references ?? (await loadStorageReferences());
  const keys = new Set(refs.keys);
  const storeIds = new Set(refs.storeIds);

  const result: SweepResult = {
    scanned: 0,
    referenced: 0,
    tooRecent: 0,
    orphans: [],
    deleted: [],
    failed: [],
  };
  for await (const object of storage.list(PREFIX)) {
    const storeId = object.key.split("/")[1];
    if (!storeId) continue;
    result.scanned++;
    if (keys.has(object.key) && storeIds.has(storeId)) {
      result.referenced++;
      continue;
    }
    if (now.getTime() - object.lastModified.getTime() < minAgeMs) {
      result.tooRecent++;
      continue;
    }
    result.orphans.push({ ...object, reason: storeIds.has(storeId) ? "UNREFERENCED" : "DELETED_STORE" });
  }

  if (apply) {
    for (const o of result.orphans) {
      try {
        await storage.delete(o.key);
        result.deleted.push(o.key);
      } catch (error) {
        result.failed.push({ key: o.key, error: String((error as Error)?.message ?? error) });
      }
    }
  }
  return result;
}
