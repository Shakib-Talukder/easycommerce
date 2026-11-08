import { createId } from "@paralleldrive/cuid2";
import { withStore } from "@repo/db";
import sharp from "sharp";
import { rgbToHex } from "./store/color";
import { IMMUTABLE_CACHE_CONTROL, getStorageProvider, isSafeKey, type StorageProvider } from "./storage";

/*
 * Upload pipeline: validate (magic bytes, size, dimensions) → sharp (auto-orient,
 * strip EXIF/metadata, resize, re-encode) → immutable keys under
 * stores/<storeId>/<folder>/<cuid>.<ext>. Logos use it now; Day 3 product
 * images add a kind to IMAGE_KINDS and reuse processAndStoreImage().
 */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Smallest accepted short edge for logos; see IMAGE_MIN_PX_BY_KIND for the others. */
export const IMAGE_MIN_PX = 128;
/**
 * Decoded size limit (width × height). Bigger images are rejected before decoding,
 * so a small, highly compressed file can't make sharp allocate gigabytes.
 */
export const IMAGE_MAX_PIXELS = 40_000_000;
/** Options for every sharp() call on untrusted input. */
const SHARP_INPUT = { limitInputPixels: IMAGE_MAX_PIXELS } as const;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

type Variant = {
  folder: string;
  width: number;
  height: number;
  /** inside: keep aspect ratio within the box; contain: pad to an exact square. */
  fit: "inside" | "contain";
  format: "webp" | "png";
};

export const IMAGE_KINDS = {
  logo: {
    logo: { folder: "logo", width: 512, height: 512, fit: "inside", format: "webp" },
    favicon: { folder: "favicon", width: 64, height: 64, fit: "contain", format: "png" },
  },
  // Both under stores/<id>/product/ (product_images_key_chk).
  product: {
    image: { folder: "product", width: 1600, height: 1600, fit: "inside", format: "webp" },
    thumb: { folder: "product/thumb", width: 400, height: 400, fit: "inside", format: "webp" },
  },
  category: {
    image: { folder: "category", width: 800, height: 800, fit: "inside", format: "webp" },
  },
} as const satisfies Record<string, Record<string, Variant>>;

export type ImageKind = keyof typeof IMAGE_KINDS;

/** Minimum short edge (after EXIF orientation) per kind. */
export const IMAGE_MIN_PX_BY_KIND: Record<ImageKind, number> = {
  logo: IMAGE_MIN_PX,
  product: 300,
  category: 300,
};

export type ImageErrorCode =
  | "UPLOAD_MISSING"
  | "UPLOAD_TYPE"
  | "UPLOAD_TOO_LARGE"
  | "UPLOAD_TOO_SMALL"
  | "UPLOAD_INVALID";

export class ImageUploadError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(code);
    this.name = "ImageUploadError";
  }
}

/** Detects JPEG, PNG or WebP from the first bytes. The browser-supplied type and name are ignored. */
export function detectImageType(data: Uint8Array): AcceptedImageType | null {
  const b = data;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export type StoredImage = { key: string; url: string; width: number; height: number; contentType: string };

export type ProcessedImage<K extends ImageKind> = {
  variants: Record<keyof (typeof IMAGE_KINDS)[K], StoredImage>;
  /** Most common colour, e.g. to suggest a brand colour from a logo. */
  dominantColor: string;
};

/** Validates, processes and stores one upload as every variant of `kind`. */
export async function processAndStoreImage<K extends ImageKind>(
  kind: K,
  input: { storeId: string; data: Buffer; storage?: StorageProvider },
): Promise<ProcessedImage<K>> {
  const { storeId, data } = input;
  if (data.length === 0) throw new ImageUploadError("UPLOAD_MISSING");
  if (data.length > IMAGE_MAX_BYTES) throw new ImageUploadError("UPLOAD_TOO_LARGE");
  if (!detectImageType(data)) throw new ImageUploadError("UPLOAD_TYPE");
  if (!/^[a-z0-9]+$/.test(storeId)) throw new Error("Invalid store id");

  let width: number;
  let height: number;
  try {
    // autoOrient: dimensions as displayed (EXIF rotation applied).
    // metadata() reads the header only, so this rejects oversized images before any decode.
    const meta = await sharp(data, { ...SHARP_INPUT, autoOrient: true }).metadata();
    width = meta.width;
    height = meta.height;
  } catch (error) {
    if (/pixel limit/i.test(String(error))) throw new ImageUploadError("UPLOAD_TOO_LARGE");
    throw new ImageUploadError("UPLOAD_INVALID");
  }
  if (width * height > IMAGE_MAX_PIXELS) throw new ImageUploadError("UPLOAD_TOO_LARGE");
  if (Math.min(width, height) < IMAGE_MIN_PX_BY_KIND[kind]) throw new ImageUploadError("UPLOAD_TOO_SMALL");

  const storage = input.storage ?? getStorageProvider();
  const stored: StoredImage[] = [];
  const variants = {} as Record<string, StoredImage>;
  try {
    for (const [name, v] of Object.entries(IMAGE_KINDS[kind]) as [string, Variant][]) {
      // .rotate() applies EXIF orientation; sharp drops EXIF/ICC/XMP unless asked to keep them.
      const pipeline = sharp(data, SHARP_INPUT)
        .rotate()
        .resize(v.width, v.height, {
          fit: v.fit,
          withoutEnlargement: v.fit === "inside",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      const { data: out, info } = await (
        v.format === "webp" ? pipeline.webp({ quality: 85 }) : pipeline.png({ compressionLevel: 9 })
      ).toBuffer({ resolveWithObject: true });
      const key = `stores/${storeId}/${v.folder}/${createId()}.${v.format}`;
      const contentType = `image/${v.format}`;
      await storage.put(key, out, contentType, IMMUTABLE_CACHE_CONTROL);
      const image = { key, url: storage.publicUrl(key), width: info.width, height: info.height, contentType };
      stored.push(image);
      variants[name] = image;
    }
  } catch (error) {
    await Promise.allSettled(stored.map((s) => storage.delete(s.key)));
    throw error;
  }

  const { dominant } = await sharp(data, SHARP_INPUT).stats();
  return {
    variants: variants as ProcessedImage<K>["variants"],
    dominantColor: rgbToHex(dominant.r, dominant.g, dominant.b),
  };
}

export class ForeignKeyError extends Error {
  readonly code = "KEY_OUTSIDE_PREFIX";
  constructor(key: string) {
    super(`Storage key outside the store's prefix: ${key}`);
  }
}

/** Throws unless `key` is a safe key under stores/<storeId>/<folder>/. */
export function assertStoreKey(storeId: string, key: string, folder: string): void {
  if (!isSafeKey(key) || !key.startsWith(`stores/${storeId}/${folder}/`)) throw new ForeignKeyError(key);
}

export type LogoFiles = { logo: StoredImage; favicon: StoredImage };

/**
 * Points the store at a new logo + favicon, then best-effort deletes the
 * previous files. Keys outside stores/<storeId>/ are rejected (also enforced
 * by CHECK constraints).
 */
export async function saveStoreLogo(
  storeId: string,
  files: LogoFiles,
  storage: StorageProvider = getStorageProvider(),
): Promise<{ deleted: string[] }> {
  assertStoreKey(storeId, files.logo.key, IMAGE_KINDS.logo.logo.folder);
  assertStoreKey(storeId, files.favicon.key, IMAGE_KINDS.logo.favicon.folder);

  const previous = await withStore(storeId, async (tx) => {
    const old = await tx.storeSettings.findUniqueOrThrow({
      where: { storeId },
      select: { logoKey: true, faviconKey: true },
    });
    await tx.storeSettings.update({
      where: { storeId },
      data: {
        logoKey: files.logo.key,
        logoUrl: files.logo.url,
        faviconKey: files.favicon.key,
        faviconUrl: files.favicon.url,
      },
    });
    return [old.logoKey, old.faviconKey];
  });

  const stale = previous.filter(
    (k): k is string => Boolean(k) && k !== files.logo.key && k !== files.favicon.key,
  );
  const results = await Promise.allSettled(stale.map((k) => storage.delete(k)));
  return { deleted: stale.filter((_, i) => results[i]?.status === "fulfilled") };
}
