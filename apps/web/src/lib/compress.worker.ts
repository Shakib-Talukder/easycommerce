/// <reference lib="webworker" />
/**
 * Web Worker: decodes a photo (EXIF orientation applied), resizes and re-encodes
 * it with OffscreenCanvas, off the main thread. See image-compress.ts.
 */
import { encodeLoop } from "./image-encode";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<Blob>) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(e.data, { imageOrientation: "from-image" });
  } catch {
    self.postMessage({ ok: false, error: "UNDECODABLE" });
    return;
  }
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const result = await encodeLoop(bitmap.width, bitmap.height, async (w, h, type, quality) => {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      return canvas.convertToBlob({ type, quality });
    });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: String((error as Error)?.message ?? error) });
  } finally {
    bitmap.close();
  }
};
