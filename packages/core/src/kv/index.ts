import { isProduction, warnOnce } from "../env";
import { MemoryKeyValueStore } from "./memory";
import { RedisKeyValueStore, connectRedis } from "./redis";
import type { KeyValueStore } from "./types";

export type { KeyValueStore } from "./types";
export { MemoryKeyValueStore } from "./memory";
export { RedisKeyValueStore, connectRedis } from "./redis";

// One store per process, shared across Next.js bundles and hot reloads.
const globalForKv = globalThis as unknown as { __ecKv?: Promise<KeyValueStore> };

/**
 * Redis when REDIS_URL is reachable. Otherwise an in-memory store in
 * development/test (warning once). In production a missing or unreachable
 * Redis is an error: in-memory state would silently break rate limits and
 * one-time tokens across instances.
 */
export function getKeyValueStore(): Promise<KeyValueStore> {
  globalForKv.__ecKv ??= createKeyValueStore().catch((error: unknown) => {
    globalForKv.__ecKv = undefined; // allow a retry on the next call
    throw error;
  });
  return globalForKv.__ecKv;
}

async function createKeyValueStore(): Promise<KeyValueStore> {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      return new RedisKeyValueStore(await connectRedis(url));
    } catch (error) {
      if (isProduction()) {
        throw new Error(
          `Redis at REDIS_URL is unreachable (${String(error)}); refusing to run in production.`,
        );
      }
    }
  } else if (isProduction()) {
    throw new Error("REDIS_URL is required in production.");
  }
  warnOnce(
    "kv-memory",
    "[kv] Redis unavailable, using an in-memory store. Rate limits and one-time tokens reset on restart. Dev only.",
  );
  return new MemoryKeyValueStore();
}

/** Test hook: replace the process-wide store. */
export function setKeyValueStore(store: KeyValueStore | undefined): void {
  globalForKv.__ecKv = store ? Promise.resolve(store) : undefined;
}
