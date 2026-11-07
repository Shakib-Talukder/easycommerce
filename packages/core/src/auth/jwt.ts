/**
 * Session JWTs (HS256 via jose). Depends only on jose and env, so the Next.js
 * proxy can import it without pulling in the database or other adapters.
 */
import { SignJWT, jwtVerify } from "jose";
import { isProduction, jwtSecret } from "../env";

export const SESSION_COOKIE = "ec_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Re-issue the token when less than this much lifetime remains. */
export const SESSION_REFRESH_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;

const ISSUER = "easycommerce";
const AUDIENCE = "merchant-admin";

export type Role = "OWNER" | "STAFF";
export type SessionClaims = { sub: string; storeId: string; role: Role; sid: string };
export type VerifiedSession = SessionClaims & { exp: number; iat: number };

export async function signSessionToken(
  claims: SessionClaims,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: Date }> {
  const exp = nowSeconds + SESSION_TTL_SECONDS;
  const token = await new SignJWT({ storeId: claims.storeId, role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(exp)
    .sign(jwtSecret());
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Signature, expiry, issuer and audience check. Returns null for any invalid token. */
export async function verifySessionToken(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const { sub, storeId, role, sid, exp, iat } = payload;
    if (
      typeof sub !== "string" ||
      typeof storeId !== "string" ||
      typeof sid !== "string" ||
      (role !== "OWNER" && role !== "STAFF") ||
      typeof exp !== "number" ||
      typeof iat !== "number"
    ) {
      return null;
    }
    return { sub, storeId, role, sid, exp, iat };
  } catch {
    return null;
  }
}

export function needsRefresh(exp: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return exp - nowSeconds < SESSION_REFRESH_THRESHOLD_SECONDS;
}

/** Host-only (no Domain attribute) so a store's cookie never reaches another store's subdomain. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Browsers accept Secure cookies on http://*.localhost, so this works locally too.
    secure: isProduction(),
    path: "/",
    expires: expiresAt,
  };
}
