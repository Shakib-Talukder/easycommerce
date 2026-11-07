import { forStore, storeDisplayName, withStore, type StoreStatus, type TenantTx } from "@repo/db";
import type { Identifier } from "@repo/db/validation";
import { otpTtlSeconds } from "../env";
import { sendOtpMessage } from "../notify";
import { checkOtpSendLimits, getRateLimiter, type RateLimiter } from "../rate-limit";
import { OTP_MAX_ATTEMPTS, generateOtp, hashOtp, verifyOtpHash } from "./crypto";
import type { Role } from "./jwt";

/** Invites stay valid longer than login codes: staff may not see them right away. */
export const INVITE_TTL_SECONDS = 24 * 60 * 60;

export type StoreContext = {
  id: string;
  subdomain: string;
  nameBn: string;
  nameEn: string;
  /** Display name in the store's language (used in OTP messages). */
  name: string;
  /** Storefront default language. */
  language: "bn" | "en";
  status: StoreStatus;
  onboardingCompleted: boolean;
};

export type SendCodeResult = { ok: true } | { ok: false; error: "RATE_LIMITED" };

export type VerifyCodeResult =
  | { ok: true; user: { id: string; role: Role; name: string } }
  | { ok: false; error: "INVALID_CODE" | "TOO_MANY_ATTEMPTS" };

const userWhere = (identifier: Identifier) =>
  identifier.kind === "email" ? { email: identifier.value } : { phone: identifier.value };

/** Creates a new code for `identifier`, invalidating its earlier unused codes. Returns the plain code. */
export async function issueOtp(
  tx: TenantTx,
  storeId: string,
  identifier: Identifier,
  purpose: "LOGIN" | "INVITE",
): Promise<string> {
  const now = new Date();
  await tx.otpCode.updateMany({
    where: { identifier: identifier.value, purpose, consumedAt: null },
    data: { consumedAt: now },
  });
  const code = generateOtp();
  const ttl = purpose === "INVITE" ? INVITE_TTL_SECONDS : otpTtlSeconds();
  await tx.otpCode.create({
    data: {
      storeId,
      identifier: identifier.value,
      purpose,
      codeHash: hashOtp(storeId, identifier.value, code),
      expiresAt: new Date(now.getTime() + ttl * 1000),
    },
  });
  return code;
}

/**
 * Sends a login code if `identifier` belongs to an active user of the store.
 * The response is the same whether or not the user exists.
 */
export async function requestLoginCode(input: {
  store: StoreContext;
  identifier: Identifier;
  ip: string;
  limiter?: RateLimiter;
}): Promise<SendCodeResult> {
  const { store, identifier, ip } = input;
  const limiter = input.limiter ?? (await getRateLimiter());
  if (!(await checkOtpSendLimits(limiter, `store:${store.id}`, identifier.value, ip))) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  const code = await withStore(store.id, async (tx) => {
    const user = await tx.user.findFirst({
      where: { ...userWhere(identifier), isActive: true },
      select: { id: true },
    });
    return user ? issueOtp(tx, store.id, identifier, "LOGIN") : null;
  });

  if (code) {
    await sendOtpMessage({
      to: identifier,
      code,
      purpose: "LOGIN",
      storeName: store.name,
      language: store.language,
      ttlMinutes: Math.round(otpTtlSeconds() / 60),
    });
  }
  return { ok: true };
}

/**
 * Checks a LOGIN or INVITE code: at most 5 attempts, single use, constant-time
 * compare. A valid INVITE code activates the invited staff member.
 */
export async function verifyLoginCode(input: {
  storeId: string;
  identifier: Identifier;
  code: string;
}): Promise<VerifyCodeResult> {
  const { storeId, identifier } = input;
  const code = input.code.trim();
  return withStore(storeId, async (tx): Promise<VerifyCodeResult> => {
    const now = new Date();
    const otp = await tx.otpCode.findFirst({
      where: {
        identifier: identifier.value,
        purpose: { in: ["LOGIN", "INVITE"] },
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { ok: false, error: "INVALID_CODE" };

    // Count the attempt first (row-locking), so parallel guesses can't exceed the limit.
    const counted = await tx.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    if (!verifyOtpHash(storeId, identifier.value, code, otp.codeHash)) {
      return {
        ok: false,
        error: otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE",
      };
    }

    const consumed = await tx.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) return { ok: false, error: "INVALID_CODE" };

    const user = await tx.user.findFirst({ where: userWhere(identifier) });
    if (!user) return { ok: false, error: "INVALID_CODE" };
    if (!user.isActive && otp.purpose !== "INVITE") return { ok: false, error: "INVALID_CODE" };

    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, ...(otp.purpose === "INVITE" ? { isActive: true } : {}) },
    });
    return { ok: true, user: { id: user.id, role: user.role, name: user.name } };
  });
}

/** Store row + the settings every admin page needs (language, onboarding state). */
export async function loadStoreContext(store: {
  id: string;
  subdomain: string;
  nameBn: string;
  nameEn: string;
  status: StoreStatus;
}): Promise<StoreContext> {
  const settings = await forStore(store.id).storeSettings.findUnique({
    where: { storeId: store.id },
    select: { language: true, onboardingCompletedAt: true },
  });
  const language = settings?.language ?? "bn";
  return {
    id: store.id,
    subdomain: store.subdomain,
    nameBn: store.nameBn,
    nameEn: store.nameEn,
    name: storeDisplayName(store, language),
    language,
    status: store.status,
    onboardingCompleted: Boolean(settings?.onboardingCompletedAt),
  };
}
