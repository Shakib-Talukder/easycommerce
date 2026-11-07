import { createId } from "@paralleldrive/cuid2";
import { Prisma, withStore } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import type { Identifier } from "@repo/db/validation";
import { otpTtlSeconds } from "../env";
import { getKeyValueStore, type KeyValueStore } from "../kv";
import { sendOtpMessage } from "../notify";
import { checkOtpSendLimits, getRateLimiter, type RateLimiter } from "../rate-limit";
import { OTP_MAX_ATTEMPTS, generateOtp, hashOtp, verifyOtpHash } from "./crypto";

/**
 * Store signup. The store doesn't exist yet, so the OTP lives in the
 * KeyValueStore (keyed by subdomain + identifier), not in otp_codes.
 */

type PendingSignup = { codeHash: string; storeName: string };

const pendingKey = (subdomain: string, identifier: string) => `signup:${subdomain}:${identifier}`;
const attemptsKey = (subdomain: string, identifier: string) => `signup-attempts:${subdomain}:${identifier}`;
const scopeFor = (subdomain: string) => `signup:${subdomain}`;

export type StartSignupInput = {
  storeName: string;
  subdomain: string;
  identifier: Identifier;
  ip: string;
  language?: "bn" | "en";
  kv?: KeyValueStore;
  limiter?: RateLimiter;
};

export type StartSignupResult = { ok: true } | { ok: false; error: "SUBDOMAIN_TAKEN" | "RATE_LIMITED" };

/** Availability check. Uses the BYPASSRLS role because it must see every store. */
export async function isSubdomainAvailable(subdomain: string): Promise<boolean> {
  const existing = await adminClient().store.findUnique({ where: { subdomain }, select: { id: true } });
  return existing === null;
}

export async function startSignup(input: StartSignupInput): Promise<StartSignupResult> {
  const { storeName, subdomain, identifier, ip } = input;
  const limiter = input.limiter ?? (await getRateLimiter());
  if (!(await checkOtpSendLimits(limiter, "signup", identifier.value, ip))) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  if (!(await isSubdomainAvailable(subdomain))) return { ok: false, error: "SUBDOMAIN_TAKEN" };

  const kv = input.kv ?? (await getKeyValueStore());
  const ttl = otpTtlSeconds();
  const code = generateOtp();
  const pending: PendingSignup = {
    codeHash: hashOtp(scopeFor(subdomain), identifier.value, code),
    storeName,
  };
  await kv.set(pendingKey(subdomain, identifier.value), JSON.stringify(pending), ttl);
  await kv.del(attemptsKey(subdomain, identifier.value));

  await sendOtpMessage({
    to: identifier,
    code,
    purpose: "SIGNUP",
    storeName,
    language: input.language ?? "bn",
    ttlMinutes: Math.round(ttl / 60),
  });
  return { ok: true };
}

export type CompleteSignupResult =
  | { ok: true; store: { id: string; subdomain: string; name: string }; owner: { id: string } }
  | { ok: false; error: "INVALID_CODE" | "TOO_MANY_ATTEMPTS" | "SUBDOMAIN_TAKEN" };

/**
 * Verifies the code, then creates store + settings + OWNER in ONE transaction
 * as app_user under RLS (app.store_id = the new id), without the admin role.
 */
export async function completeSignup(input: {
  subdomain: string;
  identifier: Identifier;
  code: string;
  kv?: KeyValueStore;
}): Promise<CompleteSignupResult> {
  const { subdomain, identifier } = input;
  const kv = input.kv ?? (await getKeyValueStore());
  const key = pendingKey(subdomain, identifier.value);

  const raw = await kv.get(key);
  if (!raw) return { ok: false, error: "INVALID_CODE" };
  const attempts = await kv.incr(attemptsKey(subdomain, identifier.value), otpTtlSeconds());
  if (attempts > OTP_MAX_ATTEMPTS) {
    await kv.del(key);
    return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  }
  const pending = JSON.parse(raw) as PendingSignup;
  if (!verifyOtpHash(scopeFor(subdomain), identifier.value, input.code.trim(), pending.codeHash)) {
    return { ok: false, error: attempts >= OTP_MAX_ATTEMPTS ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE" };
  }
  // Single use: only the caller that actually deletes the key proceeds.
  if (!(await kv.del(key))) return { ok: false, error: "INVALID_CODE" };

  const storeId = createId();
  try {
    const store = await withStore(storeId, (tx) =>
      tx.store.create({
        data: {
          id: storeId,
          name: pending.storeName,
          subdomain,
          status: "ACTIVE",
          settings: { create: {} },
          users: {
            create: {
              name: pending.storeName,
              role: "OWNER",
              lastLoginAt: new Date(),
              ...(identifier.kind === "email" ? { email: identifier.value } : { phone: identifier.value }),
            },
          },
        },
        select: { id: true, name: true, subdomain: true, users: { select: { id: true } } },
      }),
    );
    const owner = store.users[0];
    if (!owner) throw new Error("Signup transaction did not create the owner");
    return { ok: true, store: { id: store.id, name: store.name, subdomain: store.subdomain }, owner };
  } catch (error) {
    // Lost the race for this subdomain: the unique index rejected the second insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "SUBDOMAIN_TAKEN" };
    }
    throw error;
  }
}
