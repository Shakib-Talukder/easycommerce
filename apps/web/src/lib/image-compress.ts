/**
 * Client-side photo compression before upload. Phone photos (3–12 MB, often
 * rotated, sometimes HEIC) are decoded with EXIF orientation applied, resized so
 * the long edge is ≤ 2000 px, and re-encoded as WebP (JPEG if the browser can't
 * encode WebP) at ~0.82, lowering quality step by step until the file is
 * ≤ 1.5 MB. Re-encoding through a canvas drops EXIF/GPS metadata.
 *
 * The pure functions here are unit-tested; `encodeLoop` is shared by the worker
 * (OffscreenCanvas) and the main-thread fallback (HTMLCanvasElement).
 */

import { encodeLoop, type Encoded } from "./image-encode";

export * from "./image-encode";

export class DecodeError extends Error {
  constructor() {
    super("UNDECODABLE");
    this.name = "DecodeError";
  }
}

export type CompressResult = Encoded & { originalBytes: number; file: File };

/** File name for the compressed output (extension matches the encoding). */
export function outputName(name: string, type: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.${type === "image/webp" ? "webp" : "jpg"}`;
}

/** Main-thread implementation (used when Worker/OffscreenCanvas aren't available). */
export async function compressOnMainThread(file: Blob): Promise<Encoded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new DecodeError();
  }
  try {
    const canvas = document.createElement("canvas");
    return await encodeLoop(bitmap.width, bitmap.height, async (w, h, type, quality) => {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new DecodeError();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new DecodeError())), type, quality),
      );
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Compresses one photo: in a Web Worker with OffscreenCanvas when possible,
 * otherwise on the main thread. Throws DecodeError when the browser can't read
 * the file (e.g. HEIC on Android Chrome); the original is never uploaded then.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  let encoded: Encoded;
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      encoded = await compressInWorker(file);
    } catch (error) {
      if (error instanceof DecodeError) throw error;
      encoded = await compressOnMainThread(file); // worker failed to start: fall back
    }
  } else {
    encoded = await compressOnMainThread(file);
  }
  return {
    ...encoded,
    originalBytes: file.size,
    file: new File([encoded.blob], outputName(file.name, encoded.type), { type: encoded.type }),
  };
}

function compressInWorker(file: File): Promise<Encoded> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./compress.worker.ts", import.meta.url), { type: "module" });
    const done = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<{ ok: true; result: Encoded } | { ok: false; error: string }>) => {
      done();
      if (e.data.ok) resolve(e.data.result);
      else reject(e.data.error === "UNDECODABLE" ? new DecodeError() : new Error(e.data.error));
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "worker failed"));
    };
    worker.postMessage(file);
  });
}

/** 1536 → "1.5 KB", 2_500_000 → "2.4 MB" (digits localised by the caller's formatter). */
export function sizeParts(bytes: number): { value: number; unit: "KB" | "MB" } {
  return bytes >= 1024 * 1024
    ? { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: "MB" }
    : { value: Math.max(1, Math.round(bytes / 1024)), unit: "KB" };
}
