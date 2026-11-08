/** Minimal key-value contract shared by the Redis and in-memory stores. */
export interface KeyValueStore {
  readonly kind: "redis" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET NX EX: stores the value only if the key is absent. Returns true when it was stored. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Seconds until `key` expires, or 0 when it doesn't exist. */
  ttl(key: string): Promise<number>;
  /** Returns true when the key existed. */
  del(key: string): Promise<boolean>;
  /** Atomically reads and deletes. Exactly one concurrent caller gets the value. */
  take(key: string): Promise<string | null>;
  /** Increments a counter; the TTL is set when the key is created and not extended. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}
