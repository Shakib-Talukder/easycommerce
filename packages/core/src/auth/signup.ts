import { createId } from "@paralleldrive/cuid2";
import { Prisma, appClient, withStore, type TenantTx } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { RESERVED_SUBDOMAINS } from "@repo/db/host";
import { SUBDOMAIN_PATTERN, slugifySubdomain } from "@repo/db/validation";
import { otpTtlSeconds } from "../env";
import { getKeyValueStore, type KeyValueStore } from "../kv";
import { sendOtpMessage } from "../notify";
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  checkOtpSendLimits,
  claimOtpCooldown,
  getRateLimiter,
  otpCooldownSecondsLeft,
  releaseOtpCooldown,
  type RateLimiter,
} from "../rate-limit";
import { OTP_MAX_ATTEMPTS, generateOtp, hashOtp, randomToken, sha256Hex, verifyOtpHash } from "./crypto";

/**
 * Phone-first store signup on the root domain:
 *   1. startPhoneSignup   sends an OTP to a BD mobile number (KV, the store doesn't exist yet)
 *   2. verifyPhoneSignup  checks it and issues a signup ticket (KV, 30 min, bound to the phone)
 *   3. createStoreFromTicket  creates store (PENDING) + settings + OWNER in one withStore transaction
 */

export const SIGNUP_TICKET_TTL_SECONDS = 30 * 60;
/** At most 3 new stores per phone number per 24 h. */
export const STORES_PER_PHONE = { max: 3, windowSeconds: 24 * 60 * 60 } as const;
/** Live availability checks: 60 per IP per minute. */
export const SUBDOMAIN_CHECK_LIMIT = { max: 60, windowSeconds: 60 } as const;

const SCOPE = "signup";
const otpKey = (phone: string) => `signup-otp:${phone}`;
const attemptsKey = (phone: string) => `signup-otp-attempts:${phone}`;
const ticketKey = (token: string) => `signup-ticket:${sha256Hex(token)}`;

type Deps = { kv?: KeyValueStore; limiter?: RateLimiter };

// ---------------------------------------------------------------------------
// Store-per-phone limit
// ---------------------------------------------------------------------------

/**
 * Stores this phone has opened in the last 24 h. signup_store_count() is a
 * SECURITY DEFINER function, so app_user gets a count across tenants without
 * seeing any rows.
 */
async function storesOpenedRecently(phone: string, db: Pick<TenantTx, "$queryRaw"> = appClient()) {
  const since = new Date(Date.now() - STORES_PER_PHONE.windowSeconds * 1000);
  const [row] = await db.$queryRaw<{ n: number }[]>`SELECT signup_store_count(${phone}, ${since}) AS n`;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// 1 + 2: OTP and ticket
// ---------------------------------------------------------------------------

export type StartPhoneSignupResult =
  | { ok: true; cooldownSeconds: number }
  | { ok: false; error: "RATE_LIMITED" | "STORE_LIMIT" | "SEND_FAILED" }
  | { ok: false; error: "RESEND_COOLDOWN"; secondsLeft: number };

/** Seconds until `phone` can request another signup code (for the client countdown). */
export async function signupResendSecondsLeft(phone: string, kv?: KeyValueStore): Promise<number> {
  return otpCooldownSecondsLeft(kv ?? (await getKeyValueStore()), SCOPE, phone);
}

/**
 * Sends a signup code to `phone` (E.164). At most one per 60 s (RESEND_COOLDOWN),
 * 3 per phone per 15 min, 10 per IP per hour.
 */
export async function startPhoneSignup(
  input: { phone: string; ip: string; language?: "bn" | "en" } & Deps,
): Promise<StartPhoneSignupResult> {
  const { phone, ip } = input;
  if ((await storesOpenedRecently(phone)) >= STORES_PER_PHONE.max) return { ok: false, error: "STORE_LIMIT" };
  const kv = input.kv ?? (await getKeyValueStore());
  // Cooldown first, so waiting doesn't use up the 15-minute / hourly budget.
  const wait = await otpCooldownSecondsLeft(kv, SCOPE, phone);
  if (wait > 0) return { ok: false, error: "RESEND_COOLDOWN", secondsLeft: wait };
  const limiter = input.limiter ?? (await getRateLimiter());
  if (!(await checkOtpSendLimits(limiter, SCOPE, phone, ip))) return { ok: false, error: "RATE_LIMITED" };
  const claim = await claimOtpCooldown(kv, SCOPE, phone);
  if (!claim.ok) return { ok: false, error: "RESEND_COOLDOWN", secondsLeft: claim.secondsLeft };

  const ttl = otpTtlSeconds();
  const code = generateOtp();
  await kv.set(otpKey(phone), hashOtp(SCOPE, phone, code), ttl);
  await kv.del(attemptsKey(phone));

  try {
    await sendOtpMessage({
      to: { kind: "phone", value: phone },
      code,
      purpose: "SIGNUP",
      storeName: "EasyCommerce",
      language: input.language ?? "bn",
      ttlMinutes: Math.round(ttl / 60),
    });
  } catch (error) {
    console.error(`[signup] OTP send failed: ${String((error as Error)?.message ?? error)}`);
    await releaseOtpCooldown(kv, SCOPE, phone);
    return { ok: false, error: "SEND_FAILED" };
  }
  return { ok: true, cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS };
}

export type SignupTicket = { phone: string; expiresAt: number };

export type VerifyPhoneSignupResult =
  | { ok: true; ticket: string; expiresAt: Date }
  | { ok: false; error: "INVALID_CODE" | "TOO_MANY_ATTEMPTS" };

/** Checks the code (5 attempts, single use) and issues a 30-minute signup ticket bound to the phone. */
export async function verifyPhoneSignup(
  input: { phone: string; code: string } & Pick<Deps, "kv">,
): Promise<VerifyPhoneSignupResult> {
  const { phone } = input;
  const kv = input.kv ?? (await getKeyValueStore());
  const hash = await kv.get(otpKey(phone));
  if (!hash) return { ok: false, error: "INVALID_CODE" };

  const attempts = await kv.incr(attemptsKey(phone), otpTtlSeconds());
  if (attempts > OTP_MAX_ATTEMPTS) {
    await kv.del(otpKey(phone));
    return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  }
  if (!verifyOtpHash(SCOPE, phone, input.code.trim(), hash)) {
    return { ok: false, error: attempts >= OTP_MAX_ATTEMPTS ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE" };
  }
  // Single use: only the caller that actually deletes the code gets a ticket.
  if (!(await kv.del(otpKey(phone)))) return { ok: false, error: "INVALID_CODE" };

  const ticket = randomToken();
  const expiresAt = Date.now() + SIGNUP_TICKET_TTL_SECONDS * 1000;
  await kv.set(
    ticketKey(ticket),
    JSON.stringify({ phone, expiresAt } satisfies SignupTicket),
    SIGNUP_TICKET_TTL_SECONDS,
  );
  return { ok: true, ticket, expiresAt: new Date(expiresAt) };
}

const TICKET_FORMAT = /^[A-Za-z0-9_-]{20,100}$/;

/** The ticket's phone, or null if it is unknown, used or expired. Does not consume it. */
export async function readSignupTicket(
  token: string | undefined | null,
  kv?: KeyValueStore,
): Promise<SignupTicket | null> {
  if (!token || !TICKET_FORMAT.test(token)) return null;
  const store = kv ?? (await getKeyValueStore());
  const raw = await store.get(ticketKey(token));
  const ticket = raw ? (JSON.parse(raw) as SignupTicket) : null;
  return ticket && ticket.expiresAt > Date.now() ? ticket : null;
}

// ---------------------------------------------------------------------------
// Subdomain availability
// ---------------------------------------------------------------------------

export type SubdomainReason = "FORMAT" | "RESERVED" | "TAKEN";
export type SubdomainCheck = { available: boolean; reason: SubdomainReason | null; suggestions: string[] };

/** Availability check. Uses the BYPASSRLS role because it must see every store. */
export async function isSubdomainAvailable(subdomain: string): Promise<boolean> {
  const existing = await adminClient().store.findUnique({ where: { subdomain }, select: { id: true } });
  return existing === null;
}

const isWellFormed = (s: string) => SUBDOMAIN_PATTERN.test(s) && !RESERVED_SUBDOMAINS.has(s);

/** Up to `count` free alternatives derived from `base`. */
export async function suggestSubdomains(base: string, count = 3): Promise<string[]> {
  const root = slugifySubdomain(base) || "dokan";
  const fit = (suffix: string, prefix = "") =>
    `${prefix}${root.slice(0, 30 - suffix.length - prefix.length).replace(/-+$/, "")}${suffix}`;
  const candidates = [
    ...new Set(
      [
        fit("-bd"),
        fit("-shop"),
        fit("-online"),
        fit("-store"),
        fit("", "my-"),
        ...Array.from({ length: 9 }, (_, i) => fit(`-${i + 1}`)),
      ].filter((c) => c !== base && isWellFormed(c)),
    ),
  ];
  const taken = await adminClient().store.findMany({
    where: { subdomain: { in: candidates } },
    select: { subdomain: true },
  });
  const takenSet = new Set(taken.map((t) => t.subdomain));
  return candidates.filter((c) => !takenSet.has(c)).slice(0, count);
}

export async function checkSubdomain(raw: string): Promise<SubdomainCheck> {
  const s = raw.trim().toLowerCase();
  let reason: SubdomainReason | null = null;
  if (!SUBDOMAIN_PATTERN.test(s)) reason = "FORMAT";
  else if (RESERVED_SUBDOMAINS.has(s)) reason = "RESERVED";
  else if (!(await isSubdomainAvailable(s))) reason = "TAKEN";
  if (!reason) return { available: true, reason: null, suggestions: [] };
  return { available: false, reason, suggestions: await suggestSubdomains(s) };
}

/** 60 checks per IP per minute. */
export async function checkSubdomainRateLimit(ip: string, limiter?: RateLimiter): Promise<boolean> {
  const l = limiter ?? (await getRateLimiter());
  const { max, windowSeconds } = SUBDOMAIN_CHECK_LIMIT;
  return (await l.limit(`subdomain-check:ip:${ip}`, max, windowSeconds)).ok;
}

// ---------------------------------------------------------------------------
// 3: create the store
// ---------------------------------------------------------------------------

export type CreateStoreResult =
  | { ok: true; store: { id: string; subdomain: string }; owner: { id: string } }
  | { ok: false; error: "TICKET_INVALID" | "STORE_LIMIT" }
  | {
      ok: false;
      error: "SUBDOMAIN_TAKEN" | "SUBDOMAIN_RESERVED" | "SUBDOMAIN_FORMAT";
      suggestions: string[];
    };

class StoreLimitError extends Error {}

/**
 * Re-checks the subdomain, then creates store (PENDING) + settings
 * (onboarding_step 0) + OWNER in ONE transaction as app_user under RLS
 * (app.store_id = the new id). The ticket is consumed on success; on a
 * recoverable failure (subdomain taken, lost race) it is put back so the user
 * can pick another subdomain.
 */
export async function createStoreFromTicket(
  input: { ticket: string; nameBn: string; nameEn: string; subdomain: string } & Pick<Deps, "kv">,
): Promise<CreateStoreResult> {
  const kv = input.kv ?? (await getKeyValueStore());
  const subdomain = input.subdomain.trim().toLowerCase();
  if (!TICKET_FORMAT.test(input.ticket)) return { ok: false, error: "TICKET_INVALID" };

  // Claim the ticket atomically, so two submits can't both create a store.
  const raw = await kv.take(ticketKey(input.ticket));
  const ticket = raw ? (JSON.parse(raw) as SignupTicket) : null;
  if (!ticket || ticket.expiresAt <= Date.now()) return { ok: false, error: "TICKET_INVALID" };
  const putBack = async () => {
    const ttl = Math.floor((ticket.expiresAt - Date.now()) / 1000);
    if (ttl > 0) await kv.set(ticketKey(input.ticket), raw!, ttl);
  };

  const check = await checkSubdomain(subdomain);
  if (!check.available) {
    await putBack();
    return { ok: false, error: `SUBDOMAIN_${check.reason!}`, suggestions: check.suggestions };
  }

  const storeId = createId();
  try {
    const store = await withStore(storeId, async (tx) => {
      // Serialise signups per phone so the store limit is exact under concurrency.
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`signup:${ticket.phone}`}))) l`;
      if ((await storesOpenedRecently(ticket.phone, tx)) >= STORES_PER_PHONE.max) throw new StoreLimitError();
      return tx.store.create({
        data: {
          id: storeId,
          nameBn: input.nameBn,
          nameEn: input.nameEn,
          subdomain,
          status: "PENDING",
          settings: { create: { onboardingStep: 0, contactPhone: ticket.phone } },
          users: {
            create: {
              name: input.nameBn,
              role: "OWNER",
              phone: ticket.phone,
              locale: "bn",
              lastLoginAt: new Date(),
            },
          },
        },
        select: { id: true, subdomain: true, users: { select: { id: true } } },
      });
    });
    const owner = store.users[0];
    if (!owner) throw new Error("Signup transaction did not create the owner");
    return { ok: true, store: { id: store.id, subdomain: store.subdomain }, owner };
  } catch (error) {
    if (error instanceof StoreLimitError) return { ok: false, error: "STORE_LIMIT" };
    // Lost the race for this subdomain: the unique index rejected the second insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await putBack();
      return { ok: false, error: "SUBDOMAIN_TAKEN", suggestions: await suggestSubdomains(subdomain) };
    }
    await putBack();
    throw error;
  }
}
