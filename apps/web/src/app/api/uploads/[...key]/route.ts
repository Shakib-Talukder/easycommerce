import { Readable } from "node:stream";
import { getStorageProvider, isSafeKey, type LocalDiskProvider } from "@repo/core";
import type { NextRequest } from "next/server";

const TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/**
 * Serves LocalDiskProvider uploads (STORAGE_PROVIDER=local), streamed from disk.
 * Production storage (R2 / Spaces) is served from ASSET_PUBLIC_BASE_URL instead,
 * so this route 404s there. Keys are immutable (cuid per upload), so responses
 * are cacheable forever and revalidate with the ETag.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = getStorageProvider();
  const key = (await params).key.join("/");
  // kind, not instanceof: the provider is a process-wide singleton shared by separately bundled routes.
  if (storage.kind !== "local" || !isSafeKey(key)) return new Response(null, { status: 404 });
  const type = TYPES[key.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) return new Response(null, { status: 404 });

  const file = await (storage as LocalDiskProvider).open(key);
  if (!file) return new Response(null, { status: 404 });

  const etag = `"${file.size.toString(16)}-${Math.floor(file.mtime.getTime()).toString(16)}"`;
  const headers = {
    "Content-Type": type,
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    "Last-Modified": file.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag || t.trim() === "*")) {
    return new Response(null, { status: 304, headers });
  }
  const body = Readable.toWeb(file.stream()) as ReadableStream<Uint8Array>;
  return new Response(body, { headers: { ...headers, "Content-Length": String(file.size) } });
}
