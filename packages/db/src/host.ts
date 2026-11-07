/** Subdomains that can never belong to a store. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "admin",
  "api",
  "dashboard",
  "mail",
  "static",
  "assets",
  "cdn",
  "help",
  "support",
  "status",
]);

export type HostTarget =
  | { kind: "root" }
  | { kind: "subdomain"; subdomain: string }
  | { kind: "custom"; domain: string };

/**
 * Classifies a request Host header relative to ROOT_DOMAIN.
 *   parseHost("shop.example.com", "example.com") -> subdomain "shop"
 *   parseHost("myshop.com.bd", "example.com")    -> custom domain
 */
export function parseHost(host: string, rootDomain: string): HostTarget {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  const root = rootDomain.trim().toLowerCase();
  // Compare without ports unless ROOT_DOMAIN itself has one (e.g. localhost:3000).
  const strip = (s: string) => s.replace(/:\d+$/, "");
  const [hostCmp, rootCmp] = root.includes(":") ? [h, root] : [strip(h), strip(root)];

  if (hostCmp === rootCmp || hostCmp === `www.${rootCmp}`) return { kind: "root" };
  if (hostCmp.endsWith(`.${rootCmp}`)) {
    const sub = hostCmp.slice(0, -(rootCmp.length + 1));
    if (!sub.includes(".") && !RESERVED_SUBDOMAINS.has(sub)) return { kind: "subdomain", subdomain: sub };
    return { kind: "root" };
  }
  return { kind: "custom", domain: strip(h) };
}
