import type { KeyValueStore } from "./types";

type Entry = { value: string; expiresAt: number };

/**
 * Single-process store for development and tests. Data is lost on restart and
 * not shared between processes, so it is refused in production (see ./index).
 */
export class MemoryKeyValueStore implements KeyValueStore {
  readonly kind = "memory";
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async del(key: string) {
    const existed = this.live(key) !== undefined;
    this.entries.delete(key);
    return existed;
  }

  async take(key: string) {
    const value = this.live(key)?.value ?? null;
    this.entries.delete(key);
    return value;
  }

  async incr(key: string, ttlSeconds: number) {
    const entry = this.live(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    this.entries.set(key, {
      value: String(next),
      expiresAt: entry?.expiresAt ?? this.now() + ttlSeconds * 1000,
    });
    return next;
  }
}
