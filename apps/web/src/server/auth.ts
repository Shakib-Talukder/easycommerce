import "server-only";
import {
  SESSION_COOKIE,
  can,
  loadStoreContext,
  sessionCookieOptions,
  validateSession,
  type Permission,
  type Role,
} from "@repo/core";
import { findStoreByHost } from "@repo/db/admin";
import { cookies } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { cache } from "react";
import { requestHost } from "./request";

/** The store for the current Host header (404 on the root domain or an unknown host). */
export const getCurrentStore = cache(async () => {
  const store = await findStoreByHost(await requestHost(), process.env.ROOT_DOMAIN ?? "localhost:3000");
  if (!store) notFound();
  return loadStoreContext(store);
});

/**
 * Full session check for the current request: JWT valid, issued for THIS
 * store, sessions row not revoked or expired, user active. Cached per request.
 */
export const getSession = cache(async () => {
  const store = await getCurrentStore();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const valid = await validateSession(token, store.id);
  return valid ? { ...valid, store } : null;
});

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return session;
}

/** 403 unless the user has `role` (OWNER satisfies every role check). */
export async function requireRole(role: Role) {
  const session = await requireUser();
  if (role === "OWNER" && session.user.role !== "OWNER") forbidden();
  return session;
}

export async function requirePermission(permission: Permission) {
  const session = await requireUser();
  if (!can(session.user.role, permission)) forbidden();
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
