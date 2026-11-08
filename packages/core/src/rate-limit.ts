import { getKeyValueStore, type KeyValueStore } from "./kv";

export type RateLimitResult = { ok: boolean; count: number; remaining: number };

export interface RateLimiter {
  /** Counts one hit for `key` in a fixed window and reports whether it is within `max`. */
  limit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** Fixed-window limiter on top of any KeyValueStore (Redis or memory). */
export class KvRateLimiter implements RateLimiter {
  constructor(private readonly kv: KeyValueStore) {}

  async limit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
    const count = await this.kv.incr(`rl:${key}`, windowSeconds);
    return { ok: count <= max, count, remaining: Math.max(0, max - count) };
  }
}

export async function getRateLimiter(): Promise<RateLimiter> {
  return new KvRateLimiter(await getKeyValueStore());
}

/** Minimum time between two OTP sends to one identifier in one scope. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

const cooldownKey = (scope: string, identifier: string) => `otp-cooldown:${scope}:${identifier}`;

export type CooldownResult = { ok: true } | { ok: false; secondsLeft: number };

/** Seconds until `identifier` may get another code in `scope` (0 = now). Read-only. */
export async function otpCooldownSecondsLeft(
  kv: KeyValueStore,
  scope: string,
  identifier: string,
): Promise<number> {
  return kv.ttl(cooldownKey(scope, identifier));
}

/** Atomically starts the 60 s cooldown (SET NX EX), so two concurrent requests can't both send. */
export async function claimOtpCooldown(
  kv: KeyValueStore,
  scope: string,
  identifier: string,
): Promise<CooldownResult> {
  if (await kv.setIfAbsent(cooldownKey(scope, identifier), "1", OTP_RESEND_COOLDOWN_SECONDS))
    return { ok: true };
  return { ok: false, secondsLeft: Math.max(1, await otpCooldownSecondsLeft(kv, scope, identifier)) };
}

/** Lifts the cooldown, e.g. when the send itself failed and the user should be able to retry. */
export async function releaseOtpCooldown(
  kv: KeyValueStore,
  scope: string,
  identifier: string,
): Promise<void> {
  await kv.del(cooldownKey(scope, identifier));
}

/** OTP send limits from the spec. */
export const OTP_SEND_LIMITS = {
  perIdentifier: { max: 3, windowSeconds: 15 * 60 },
  perIp: { max: 10, windowSeconds: 60 * 60 },
} as const;

/**
 * Applies both OTP send limits. The IP bucket is checked first so one client
 * can't burn through other people's identifier buckets.
 */
export async function checkOtpSendLimits(
  limiter: RateLimiter,
  scope: string,
  identifier: string,
  ip: string,
): Promise<boolean> {
  const byIp = await limiter.limit(
    `otp:ip:${ip}`,
    OTP_SEND_LIMITS.perIp.max,
    OTP_SEND_LIMITS.perIp.windowSeconds,
  );
  if (!byIp.ok) return false;
  const byId = await limiter.limit(
    `otp:id:${scope}:${identifier}`,
    OTP_SEND_LIMITS.perIdentifier.max,
    OTP_SEND_LIMITS.perIdentifier.windowSeconds,
  );
  return byId.ok;
}
