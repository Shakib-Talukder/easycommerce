import "server-only";
import { categoryOptions, getProductForEdit } from "@repo/core";
import { poishaToTakaString } from "@repo/db";
import type { EditorProduct } from "@/components/catalog/product-editor";

/** 6000 → "60", 6050 → "60.50". */
export const takaInput = (poisha: number | null | undefined) =>
  poisha === null || poisha === undefined ? "" : poishaToTakaString(poisha).replace(/\.00$/, "");

/** Category options for selects, in the admin's language. */
export async function categorySelectOptions(storeId: string, locale: "bn" | "en") {
  return (await categoryOptions(storeId)).map((c) => ({
    id: c.id,
    depth: c.depth,
    name: locale === "en" ? c.nameEn : c.nameBn,
  }));
}

/** The editor's initial state for an existing product, or null if not found / in the trash. */
export async function loadEditorProduct(storeId: string, id: string): Promise<EditorProduct | null> {
  const p = await getProductForEdit(storeId, id);
  if (!p) return null;
  return {
    id: p.id,
    slug: p.slug,
    titleBn: p.titleBn,
    titleEn: p.titleEn,
    descriptionBn: p.descriptionBn ?? "",
    descriptionEn: p.descriptionEn ?? "",
    categoryId: p.categoryId ?? "",
    status: p.status,
    isFeatured: p.isFeatured,
    defaultPrice: takaInput(p.variants[0]?.price),
    options: p.options,
    variants: p.variants.map((v) => ({
      id: v.id,
      optionValues: v.optionValues,
      sku: v.sku,
      price: takaInput(v.price),
      salePrice: takaInput(v.salePrice),
      stock: String(v.stock),
      isActive: v.isActive,
      imageId: v.imageId,
    })),
    images: p.images.map((i) => ({
      id: i.id,
      url: i.url,
      thumbUrl: i.thumbUrl,
      altBn: i.altBn,
      altEn: i.altEn,
    })),
  };
}
