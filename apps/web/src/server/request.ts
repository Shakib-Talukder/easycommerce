import "server-only";
import { headers } from "next/headers";

/**
 * Client IP for rate limiting. Trusts the first X-Forwarded-For hop, which is
 * only correct behind a proxy that overwrites it (see docs/day-1-notes.md).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function requestHost(): Promise<string> {
  return (await headers()).get("host") ?? "";
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** X-Forwarded-Proto when present, else http for *.localhost and https everywhere else. */
export async function requestProtocol(): Promise<"http" | "https"> {
  const proto = (await headers()).get("x-forwarded-proto");
  if (proto === "http" || proto === "https") return proto;
  return (process.env.ROOT_DOMAIN ?? "localhost").startsWith("localhost") ? "http" : "https";
}
