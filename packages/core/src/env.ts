export const isProduction = (): boolean => process.env.NODE_ENV === "production";

let cachedSecret: { raw: string; key: Uint8Array } | undefined;

/** JWT_SECRET as key bytes. Also used as the pepper for OTP and token hashes. */
export function jwtSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET ?? "";
  if (raw.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters");
  if (cachedSecret?.raw !== raw) cachedSecret = { raw, key: new TextEncoder().encode(raw) };
  return cachedSecret.key;
}

export function otpTtlSeconds(): number {
  const ttl = Number(process.env.OTP_TTL_SECONDS ?? 300);
  return Number.isInteger(ttl) && ttl > 0 ? ttl : 300;
}

export function rootDomain(): string {
  return process.env.ROOT_DOMAIN ?? "localhost:3000";
}

/** Log a warning only once per process (per key). */
const warned = new Set<string>();
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
