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

export const MAX_EDGE = 2000;
export const TARGET_BYTES = 1.5 * 1024 * 1024;
export const START_QUALITY = 0.82;
export const MIN_QUALITY = 0.5;
export const QUALITY_STEP = 0.08;
/** If even MIN_QUALITY is too big, shrink the image by this factor and retry. */
export const SHRINK_FACTOR = 0.8;
export const MIN_EDGE = 300;

/** Size that fits within maxEdge on the long side, keeping the aspect ratio (never enlarges). */
export function targetDimensions(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Qualities to try, highest first: 0.82, 0.74, 0.66, 0.58, 0.5. */
export function qualitySteps(start = START_QUALITY, min = MIN_QUALITY, step = QUALITY_STEP): number[] {
  const out: number[] = [];
  for (let q = start; q >= min - 1e-9; q -= step) out.push(Math.round(q * 100) / 100);
  return out;
}

/**
 * The encoding plan: for each size (full target size, then shrinking by
 * SHRINK_FACTOR while the short edge stays ≥ MIN_EDGE), every quality step.
 */
export function encodingPlan(
  width: number,
  height: number,
): { width: number; height: number; quality: number }[] {
  const plan: { width: number; height: number; quality: number }[] = [];
  let size = targetDimensions(width, height);
  for (let i = 0; i < 4; i++) {
    for (const quality of qualitySteps()) plan.push({ ...size, quality });
    const next = {
      width: Math.round(size.width * SHRINK_FACTOR),
      height: Math.round(size.height * SHRINK_FACTOR),
    };
    if (Math.min(next.width, next.height) < MIN_EDGE) break;
    size = next;
  }
  return plan;
}

export type Encoded = { blob: Blob; width: number; height: number; quality: number; type: string };

/**
 * Tries the plan in order and returns the first encoding ≤ targetBytes (or the
 * smallest one if none fits). `render` draws the bitmap at a size and encodes it.
 */
export async function encodeLoop(
  width: number,
  height: number,
  render: (w: number, h: number, type: string, quality: number) => Promise<Blob>,
  targetBytes = TARGET_BYTES,
): Promise<Encoded> {
  let type = "image/webp";
  let best: Encoded | null = null;
  for (const step of encodingPlan(width, height)) {
    let blob = await render(step.width, step.height, type, step.quality);
    // A browser that can't encode WebP returns PNG instead: switch to JPEG for good.
    if (type === "image/webp" && blob.type !== "image/webp") {
      type = "image/jpeg";
      blob = await render(step.width, step.height, type, step.quality);
    }
    const encoded = { blob, width: step.width, height: step.height, quality: step.quality, type };
    if (!best || blob.size < best.blob.size) best = encoded;
    if (blob.size <= targetBytes) return encoded;
  }
  return best!;
}

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
