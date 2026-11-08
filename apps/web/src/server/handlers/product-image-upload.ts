import { SESSION_COOKIE, addProductImage, can, validateSession, type StorageProvider } from "@repo/core";
import { findStoreByHost } from "@repo/db/admin";

/** Compressed in the browser to ≤ 1.5 MB; the server accepts up to 5 MB (+ multipart overhead). */
export const MAX_UPLOAD_BODY_BYTES = 6 * 1024 * 1024;

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  IMAGE_LIMIT: 409,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_TYPE: 415,
  UPLOAD_MISSING: 400,
  UPLOAD_TOO_SMALL: 422,
  UPLOAD_INVALID: 422,
};

export type Translate = (
  locale: "bn" | "en",
  code: string,
  values?: Record<string, number>,
) => Promise<string>;

function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

/**
 * POST /api/admin/products/:id/images (multipart, field "file"). A route handler
 * rather than a server action so the browser can report upload progress (XHR).
 * Same checks as a server action: same-origin Origin, a valid session for THIS
 * store's host, and catalog:manage.
 *   → 201 { ok: true, image } | 4xx { ok: false, code, message }
 */
export async function handleProductImageUpload(
  request: Request,
  productId: string,
  deps: { translate: Translate; rootDomain?: string; storage?: StorageProvider },
): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  let locale: "bn" | "en" = cookie(request, "ec_locale") === "en" ? "en" : "bn";
  const fail = async (code: string, values?: Record<string, number>) =>
    Response.json(
      { ok: false, code, message: await deps.translate(locale, code, values) },
      { status: STATUS[code] ?? 400, headers: { "Cache-Control": "no-store" } },
    );

  // CSRF: only same-origin browser requests.
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
  if (!can(session.user.role, "catalog:manage")) return fail("FORBIDDEN");

  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BODY_BYTES)
    return fail("UPLOAD_TOO_LARGE");
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return fail("UPLOAD_MISSING");
  }
  if (!(file instanceof File) || file.size === 0) return fail("UPLOAD_MISSING");
  if (file.size > MAX_UPLOAD_BODY_BYTES) return fail("UPLOAD_TOO_LARGE");

  const result = await addProductImage(
    store.id,
    productId,
    Buffer.from(await file.arrayBuffer()),
    deps.storage,
  );
  if (!result.ok) return fail(result.error, "values" in result ? result.values : undefined);
  return Response.json(
    { ok: true, image: result.image },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
