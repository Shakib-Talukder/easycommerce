import { getStorageProvider, isSafeKey, type LocalDiskProvider } from "@repo/core";
import type { NextRequest } from "next/server";

const TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

/**
 * Serves LocalDiskProvider uploads (STORAGE_PROVIDER=local). Production
 * storage (R2 / Spaces) is served from ASSET_PUBLIC_BASE_URL instead, so this
 * route 404s there.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = getStorageProvider();
  const key = (await params).key.join("/");
  // kind, not instanceof: the provider is a process-wide singleton shared by separately bundled routes.
  if (storage.kind !== "local" || !isSafeKey(key)) return new Response(null, { status: 404 });

  const body = await (storage as LocalDiskProvider).read(key);
  const type = TYPES[key.split(".").pop() ?? ""];
  if (!body || !type) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      // Keys are never reused (cuid per upload).
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
