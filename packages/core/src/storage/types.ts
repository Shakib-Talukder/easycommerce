/** One stored object, as listed by StorageProvider.list(). */
export type StoredObject = { key: string; size: number; lastModified: Date };

/** Object storage for user uploads (logos now, product images on Day 3). */
export interface StorageProvider {
  readonly kind: "local" | "s3";
  put(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** URL a browser can load the object from (CDN, public bucket, or the dev route). */
  publicUrl(key: string): string;
  /** Every object whose key starts with `prefix` (e.g. "stores/"), in no particular order. */
  list(prefix: string): AsyncIterable<StoredObject>;
}

/** Cache-Control for content-addressed (never overwritten) keys. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Keys are relative paths of [a-z0-9._-] segments, e.g. stores/<storeId>/logo/<cuid>.webp. */
const SAFE_KEY = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_.-]*)*$/;

export function isSafeKey(key: string): boolean {
  return key.length <= 300 && SAFE_KEY.test(key) && !key.split("/").includes("..");
}

export function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
}
