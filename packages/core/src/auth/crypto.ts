import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { jwtSecret } from "../env";

export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;

/** Uniform 6-digit code from the CSPRNG. */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

/**
 * HMAC-SHA256 keyed with JWT_SECRET (the pepper), bound to the scope (store id
 * or signup subdomain) and identifier, so a hash is useless anywhere else.
 */
export function hashOtp(scope: string, identifier: string, code: string): string {
  return createHmac("sha256", jwtSecret()).update(`otp|${scope}|${identifier}|${code}`).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function verifyOtpHash(
  scope: string,
  identifier: string,
  code: string,
  expectedHash: string,
): boolean {
  if (!/^\d{6}$/.test(code)) {
    // Still do the work so malformed input isn't measurably faster.
    safeEqualHex(hashOtp(scope, identifier, "000000"), expectedHash);
    return false;
  }
  return safeEqualHex(hashOtp(scope, identifier, code), expectedHash);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
