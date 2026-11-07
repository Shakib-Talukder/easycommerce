import { createId } from "@paralleldrive/cuid2";
import { forStore, withStore } from "@repo/db";
import { sha256Hex } from "./crypto";
import { needsRefresh, signSessionToken, verifySessionToken, type Role, type VerifiedSession } from "./jwt";

export type SessionMeta = { userAgent?: string | null; ip?: string | null };

export type IssuedSession = { token: string; expiresAt: Date; sessionId: string };

/** Creates the sessions row and its JWT. */
export async function createSession(
  storeId: string,
  user: { id: string; role: Role },
  meta: SessionMeta = {},
): Promise<IssuedSession> {
  const sessionId = createId();
  const { token, expiresAt } = await signSessionToken({
    sub: user.id,
    storeId,
    role: user.role,
    sid: sessionId,
  });
  await forStore(storeId).session.create({
    data: {
      id: sessionId,
      storeId,
      userId: user.id,
      tokenHash: sha256Hex(token),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt, sessionId };
}

export type ValidSession = {
  claims: VerifiedSession;
  session: { id: string; expiresAt: Date };
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: Role;
    locale: "bn" | "en";
  };
};

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Full server-side check: valid JWT, issued for *this* store, sessions row
 * present, not revoked, not expired, user still active.
 */
export async function validateSession(
  token: string | undefined | null,
  storeId: string,
): Promise<ValidSession | null> {
  const claims = await verifySessionToken(token);
  if (!claims || claims.storeId !== storeId) return null;

  const db = forStore(storeId);
  const session = await db.session.findUnique({
    where: { id: claims.sid },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, role: true, locale: true, isActive: true },
      },
    },
  });
  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.userId !== claims.sub ||
    !session.user.isActive
  ) {
    return null;
  }

  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.updateMany({ where: { id: session.id }, data: { lastUsedAt: now } });
  }

  const { isActive: _isActive, ...user } = session.user;
  return { claims, session: { id: session.id, expiresAt: session.expiresAt }, user };
}

/**
 * Rolling refresh: when fewer than 7 days remain, issue a new 30-day token for
 * the same session. Returns null when no refresh is needed or the session is
 * no longer valid.
 */
export async function refreshSession(token: string, storeId: string): Promise<IssuedSession | null> {
  const claims = await verifySessionToken(token);
  if (!claims || claims.storeId !== storeId || !needsRefresh(claims.exp)) return null;
  const valid = await validateSession(token, storeId);
  if (!valid) return null;

  // Role comes from the database so a role change takes effect on refresh.
  const next = await signSessionToken({
    sub: valid.user.id,
    storeId,
    role: valid.user.role,
    sid: claims.sid,
  });
  const updated = await forStore(storeId).session.updateMany({
    where: { id: claims.sid, revokedAt: null },
    data: { tokenHash: sha256Hex(next.token), expiresAt: next.expiresAt, lastUsedAt: new Date() },
  });
  return updated.count === 1 ? { ...next, sessionId: claims.sid } : null;
}

export async function revokeSession(storeId: string, sessionId: string): Promise<void> {
  await forStore(storeId).session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeUserSessions(storeId: string, userId: string): Promise<number> {
  return withStore(storeId, async (tx) => {
    const { count } = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  });
}
