import { forStore, withStore } from "@repo/db";
import type { Identifier } from "@repo/db/validation";
import { sendOtpMessage } from "../notify";
import { INVITE_TTL_SECONDS, issueOtp, type StoreContext } from "./otp";
import { revokeUserSessions } from "./sessions";

export type InviteResult = { ok: true; userId: string } | { ok: false; error: "ALREADY_MEMBER" };

/**
 * Creates (or refreshes) an inactive STAFF user and sends an INVITE code.
 * The staff member becomes active by logging in with that code.
 */
export async function inviteStaff(input: {
  store: StoreContext;
  name: string;
  identifier: Identifier;
}): Promise<InviteResult> {
  const { store, name, identifier } = input;
  const where = identifier.kind === "email" ? { email: identifier.value } : { phone: identifier.value };

  const result = await withStore(store.id, async (tx) => {
    const existing = await tx.user.findFirst({ where });
    if (existing?.isActive) return { ok: false as const, error: "ALREADY_MEMBER" as const };
    if (existing && existing.role !== "STAFF")
      return { ok: false as const, error: "ALREADY_MEMBER" as const };
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { name } })
      : await tx.user.create({ data: { storeId: store.id, name, role: "STAFF", isActive: false, ...where } });
    const code = await issueOtp(tx, store.id, identifier, "INVITE");
    return { ok: true as const, userId: user.id, code };
  });
  if (!result.ok) return result;

  await sendOtpMessage({
    to: identifier,
    code: result.code,
    purpose: "INVITE",
    storeName: store.name,
    language: store.language,
    ttlMinutes: INVITE_TTL_SECONDS / 60,
  });
  return { ok: true, userId: result.userId };
}

export type DeactivateResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "CANNOT_DEACTIVATE" };

/** Deactivates a STAFF member and revokes all their sessions. Owners can't be deactivated here. */
export async function deactivateStaff(input: {
  storeId: string;
  actorUserId: string;
  userId: string;
}): Promise<DeactivateResult> {
  const { storeId, actorUserId, userId } = input;
  if (actorUserId === userId) return { ok: false, error: "CANNOT_DEACTIVATE" };
  const user = await forStore(storeId).user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return { ok: false, error: "NOT_FOUND" };
  if (user.role !== "STAFF") return { ok: false, error: "CANNOT_DEACTIVATE" };
  await withStore(storeId, async (tx) => {
    const u = await tx.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: { email: true, phone: true },
    });
    // A pending invite must not reactivate the user later.
    const identifiers = [u.email, u.phone].filter((v): v is string => Boolean(v));
    await tx.otpCode.updateMany({
      where: { consumedAt: null, purpose: "INVITE", identifier: { in: identifiers } },
      data: { consumedAt: new Date() },
    });
  });
  await revokeUserSessions(storeId, userId);
  return { ok: true };
}

export async function listStaff(storeId: string) {
  return forStore(storeId).user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true },
  });
}
