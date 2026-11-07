"use server";

import { forStore } from "@repo/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/i18n/locale";
import { getSession } from "../auth";
import { requestSurface } from "../locale";

const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * Language toggle. Always sets the ec_locale cookie; in the admin it also
 * saves users.locale for the logged-in user, so it follows them across devices.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
  if ((await requestSurface()) === "admin") {
    const session = await getSession();
    if (session) {
      await forStore(session.store.id).user.update({ where: { id: session.user.id }, data: { locale } });
    }
  }
  revalidatePath("/", "layout");
}
