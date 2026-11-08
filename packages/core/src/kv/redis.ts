import { Redis } from "ioredis";
import type { KeyValueStore } from "./types";

export class RedisKeyValueStore implements KeyValueStore {
  readonly kind = "redis";

  constructor(private readonly redis: Redis) {}

  async get(key: string) {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    return (await this.redis.set(key, value, "EX", ttlSeconds, "NX")) === "OK";
  }

  async ttl(key: string) {
    return Math.max(0, await this.redis.ttl(key));
  }

  async del(key: string) {
    return (await this.redis.del(key)) > 0;
  }

  async take(key: string) {
    return this.redis.getdel(key);
  }

  /** MULTI/EXEC: INCR, then EXPIRE NX sets the TTL only on the window's first hit (Redis >= 7). */
  async incr(key: string, ttlSeconds: number) {
    const results = await this.redis.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
    const [incrError, count] = results?.[0] ?? [new Error("Redis transaction aborted"), null];
    if (incrError) throw incrError;
    return Number(count);
  }

  async quit() {
    await this.redis.quit();
  }
}

/** Connects or throws within ~timeoutMs. Never queues commands while offline. */
export async function connectRedis(url: string, timeoutMs = 1500): Promise<Redis> {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // RESP2 works with every Redis-compatible server, including scripts/local-redis.ts.
    protocol: 2,
    disableClientInfo: true,
    retryStrategy: (attempt) => (attempt > 5 ? null : Math.min(attempt * 200, 1000)),
  });
  // Without a listener, connection errors are thrown as unhandled events.
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.ping();
    return redis;
  } catch (error) {
    redis.disconnect();
    throw error;
  }
}
