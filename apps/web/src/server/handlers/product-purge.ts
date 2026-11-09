import {
  SESSION_COOKIE,
  can,
  permanentlyDeleteProducts,
  validateSession,
  type StorageProvider,
} from "@repo/core";
import { findStoreByHost } from "@repo/db/admin";
import type { Translate } from "./product-image-upload";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

/**
 * POST /api/admin/products/purge (form field `ids`, repeated): permanently deletes
 * trashed products and their image objects. OWNER only (catalog:delete).
 *
 * A route handler rather than a server action so that a STAFF attempt gets a real
 * HTTP 403 (forbidden() thrown inside a server action renders Next's 404 page).
 * Same checks as a server action: same-origin Origin and a session for THIS
 * store's host. Success redirects (303) back to the trash, so the plain form
 * works without JavaScript.
 */
export async function handleProductPurge(
  request: Request,
  deps: { translate: Translate; rootDomain?: string; storage?: StorageProvider },
): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  let locale: "bn" | "en" = cookie(request, "ec_locale") === "en" ? "en" : "bn";
  const fail = async (code: string) =>
    Response.json(
      { ok: false, code, message: await deps.translate(locale, code) },
      { status: STATUS[code] ?? 400, headers: { "Cache-Control": "no-store" } },
    );

  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    sameOrigin = origin !== null && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return fail("FORBIDDEN");

  const store = await findStoreByHost(host, deps.rootDomain ?? process.env.ROOT_DOMAIN ?? "localhost:3000");
  if (!store || store.status === "SUSPENDED") return fail("NOT_FOUND");
  const session = await validateSession(cookie(request, SESSION_COOKIE), store.id);
  if (!session) return fail("UNAUTHENTICATED");
  locale = session.user.locale;
  if (!can(session.user.role, "catalog:delete")) return fail("FORBIDDEN");

  let ids: string[];
  try {
    ids = (await request.formData())
      .getAll("ids")
      .map(String)
      .filter((v) => /^[a-z0-9]{1,40}$/.test(v));
  } catch {
    return fail("INVALID");
  }
  if (ids.length === 0 || ids.length > 100) return fail("INVALID");

  await permanentlyDeleteProducts(store.id, ids, deps.storage);
  // Relative Location: the browser resolves it against this store's host.
  return new Response(null, { status: 303, headers: { Location: "/admin/products/trash?deleted=1" } });
}
