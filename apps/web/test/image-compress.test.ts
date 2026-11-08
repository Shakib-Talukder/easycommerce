import { describe, expect, it } from "vitest";
import {
  MAX_EDGE,
  MIN_EDGE,
  TARGET_BYTES,
  encodeLoop,
  encodingPlan,
  outputName,
  qualitySteps,
  sizeParts,
  targetDimensions,
} from "../src/lib/image-compress";

/** A fake encoder: bytes ≈ pixels × quality × bytesPerPixel; optionally no WebP support. */
function fakeRender(bytesPerPixel: number, webp = true) {
  const calls: { w: number; h: number; type: string; quality: number }[] = [];
  const render = async (w: number, h: number, type: string, quality: number) => {
    calls.push({ w, h, type, quality });
    const outType = type === "image/webp" && !webp ? "image/png" : type;
    return new Blob([new Uint8Array(Math.round(w * h * quality * bytesPerPixel))], { type: outType });
  };
  return { render, calls };
}

describe("image compression planning", () => {
  it("fits the long edge into 2000 px, keeps the aspect ratio, never enlarges", () => {
    expect(targetDimensions(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(targetDimensions(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(targetDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(targetDimensions(10000, 10)).toEqual({ width: MAX_EDGE, height: 2 });
  });

  it("steps quality down from 0.82 to 0.5", () => {
    expect(qualitySteps()).toEqual([0.82, 0.74, 0.66, 0.58, 0.5]);
  });

  it("shrinks by 20% per round when quality alone isn't enough, but not below 300 px", () => {
    const plan = encodingPlan(4000, 3000);
    const sizes = [...new Set(plan.map((p) => `${p.width}x${p.height}`))];
    expect(sizes).toEqual(["2000x1500", "1600x1200", "1280x960", "1024x768"]);
    expect(Math.min(...plan.map((p) => Math.min(p.width, p.height)))).toBeGreaterThanOrEqual(MIN_EDGE);
    expect(encodingPlan(400, 300).every((p) => p.width === 400)).toBe(true);
  });

  it("returns the first encoding under 1.5 MB, at the highest quality that fits", async () => {
    // 2000×1500 at 0.82 ≈ 1.97 MB, at 0.58 ≈ 1.39 MB.
    const { render, calls } = fakeRender(0.8);
    const out = await encodeLoop(4000, 3000, render);
    expect(out.blob.size).toBeLessThanOrEqual(TARGET_BYTES);
    expect(out).toMatchObject({ width: 2000, height: 1500, quality: 0.58, type: "image/webp" });
    expect(calls.map((c) => c.quality)).toEqual([0.82, 0.74, 0.66, 0.58]);
  });

  it("falls back to JPEG when the browser can't encode WebP", async () => {
    const { render, calls } = fakeRender(0.1, false);
    const out = await encodeLoop(1000, 800, render);
    expect(out.type).toBe("image/jpeg");
    expect(calls.map((c) => c.type)).toEqual(["image/webp", "image/jpeg"]);
  });

  it("returns the smallest attempt when nothing fits", async () => {
    const { render } = fakeRender(100);
    const out = await encodeLoop(4000, 3000, render);
    expect(out).toMatchObject({ width: 1024, height: 768, quality: 0.5 });
  });

  it("names the output after the encoding and formats sizes", () => {
    expect(outputName("IMG_1234.HEIC", "image/webp")).toBe("IMG_1234.webp");
    expect(outputName("photo.jpeg", "image/jpeg")).toBe("photo.jpg");
    expect(sizeParts(5_400_000)).toEqual({ value: 5.1, unit: "MB" });
    expect(sizeParts(300)).toEqual({ value: 1, unit: "KB" });
  });
});
