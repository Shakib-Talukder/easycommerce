/**
 * Pure planning/encoding logic for client-side photo compression, shared by the
 * Web Worker (compress.worker.ts) and the main-thread fallback (image-compress.ts).
 * Kept separate so the worker doesn't import the module that creates it.
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
