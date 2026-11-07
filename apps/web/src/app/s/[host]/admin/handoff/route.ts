import { consumeHandoff, createSession } from "@repo/core";
import { forStore } from "@repo/db";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getCurrentStore, setSessionCookie } from "@/server/auth";
import { clientIp, userAgent } from "@/server/request";

/**
 * Exchanges the one-time signup handoff token for a host-only session cookie
 * on the new store's host.
 */
export async function GET(request: NextRequest) {
  const store = await getCurrentStore();
  const handoff = await consumeHandoff(request.nextUrl.searchParams.get("t") ?? "");
  if (!handoff || handoff.storeId !== store.id) redirect("/admin/login");

  const user = await forStore(store.id).user.findUnique({
    where: { id: handoff.userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!user?.isActive) redirect("/admin/login");

  const session = await createSession(store.id, user, { ip: await clientIp(), userAgent: await userAgent() });
  await setSessionCookie(session.token, session.expiresAt);
  // A fresh signup goes straight to the onboarding wizard.
  redirect(store.onboardingCompleted ? "/admin" : "/admin/onboarding");
}
