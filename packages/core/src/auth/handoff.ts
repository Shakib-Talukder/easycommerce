import { getKeyValueStore, type KeyValueStore } from "../kv";
import { randomToken, sha256Hex } from "./crypto";

/**
 * One-time token that carries a fresh signup from the root domain to the new
 * store's host, where it is exchanged for a host-only session cookie.
 */
export const HANDOFF_TTL_SECONDS = 60;

export type Handoff = { storeId: string; userId: string };

const key = (token: string) => `handoff:${sha256Hex(token)}`;

export async function createHandoff(handoff: Handoff, kv?: KeyValueStore): Promise<string> {
  const store = kv ?? (await getKeyValueStore());
  const token = randomToken();
  await store.set(key(token), JSON.stringify(handoff), HANDOFF_TTL_SECONDS);
  return token;
}

/** Returns the handoff once; later calls (or after 60 s) return null. */
export async function consumeHandoff(token: string, kv?: KeyValueStore): Promise<Handoff | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const store = kv ?? (await getKeyValueStore());
  const raw = await store.take(key(token));
  return raw ? (JSON.parse(raw) as Handoff) : null;
}
