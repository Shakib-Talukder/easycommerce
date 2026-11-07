import { SESSION_COOKIE, needsRefresh, sessionCookieOptions, verifySessionToken } from "@repo/core/jwt";
import { parseHost } from "@repo/db/host";
import { NextResponse, type NextRequest } from "next/server";

const STORE_PREFIX = "/s/";
/** Admin routes reachable without a session. */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/verify", "/admin/handoff"];

const isAdminPath = (p: string) => p === "/admin" || p.startsWith("/admin/");
const isPublicAdminPath = (p: string) =>
  PUBLIC_ADMIN_PATHS.some((pub) => p === pub || p.startsWith(`${pub}/`));

/**
 * Multi-tenant routing. Requests to a store's subdomain or custom domain are
 * rewritten to /s/<host>/..., where the page resolves the store from the host.
 * The root domain serves the platform pages.
 *
 * For /admin/* (except login/verify/handoff) the session JWT's signature and
 * expiry are checked here; the full check (revocation, store match) happens
 * in requireUser() on the server.
 */
export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const { pathname, search } = request.nextUrl;

  // The internal /s/ tree is only reachable through a rewrite.
  if (pathname.startsWith(STORE_PREFIX)) {
    return new NextResponse(null, { status: 404 });
  }

  const target = parseHost(host, rootDomain);
  if (target.kind === "root") return NextResponse.next();

  let refreshed: { token: string; expiresAt: Date } | null = null;
  if (isAdminPath(pathname) && !isPublicAdminPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const claims = await verifySessionToken(token);
    if (!claims) {
      const login = NextResponse.redirect(new URL("/admin/login", `${request.nextUrl.protocol}//${host}`));
      if (token) login.cookies.delete(SESSION_COOKIE);
      return login;
    }
    if (token && needsRefresh(claims.exp)) refreshed = await refreshForHost(token, host, rootDomain);
  }

  const url = request.nextUrl.clone();
  url.pathname = `${STORE_PREFIX}${encodeURIComponent(host.toLowerCase())}${pathname === "/" ? "" : pathname}`;
  url.search = search;

  if (!refreshed) return NextResponse.rewrite(url);
  // Let this request's server code see the new token, and send it to the browser.
  request.cookies.set(SESSION_COOKIE, refreshed.token);
  const response = NextResponse.rewrite(url, { request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, refreshed.token, sessionCookieOptions(refreshed.expiresAt));
  return response;
}

/** Rolling refresh, only for a token issued for the store this host serves. Rare, so loaded lazily. */
async function refreshForHost(token: string, host: string, rootDomain: string) {
  const [{ findStoreByHost }, { refreshSession }] = await Promise.all([
    import("@repo/db/admin"),
    import("@repo/core/sessions"),
  ]);
  const store = await findStoreByHost(host, rootDomain);
  return store ? refreshSession(token, store.id) : null;
}

export const config = {
  // Skip Next internals, API routes and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
