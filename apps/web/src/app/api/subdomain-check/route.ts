import { checkSubdomain, checkSubdomainRateLimit } from "@repo/core";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/server/request";

/**
 * GET /api/subdomain-check?s=<candidate>
 *   → { available, reason: "FORMAT" | "RESERVED" | "TAKEN" | null, suggestions: string[] }
 * Rate-limited to 60 requests per IP per minute (429 with { error: "RATE_LIMITED" }).
 */
export async function GET(request: NextRequest) {
  const ip = await clientIp();
  const noStore = { "Cache-Control": "no-store" };
  if (!(await checkSubdomainRateLimit(ip))) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { ...noStore, "Retry-After": "60" } },
    );
  }
  const s = (request.nextUrl.searchParams.get("s") ?? "").slice(0, 100);
  return NextResponse.json(await checkSubdomain(s), { headers: noStore });
}
