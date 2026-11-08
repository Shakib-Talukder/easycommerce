import { getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";
import { handleProductImageUpload } from "@/server/handlers/product-image-upload";

/** Product photo upload with progress; see handleProductImageUpload. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleProductImageUpload(request, id, {
    translate: async (locale, code, values) => {
      const t = await getTranslations({ locale, namespace: "errors" });
      const key = code as Parameters<typeof t>[0];
      return t.has(key) ? t(key, values as never) : t("UNKNOWN");
    },
  });
}
