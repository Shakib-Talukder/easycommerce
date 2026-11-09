import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { handleProductPurge } from "@/server/handlers/product-purge";

/** Permanent delete from the trash (OWNER only); see handleProductPurge. */
export async function POST(request: NextRequest) {
  const response = await handleProductPurge(request, {
    translate: async (locale, code) => {
      const t = await getTranslations({ locale, namespace: "errors" });
      const key = code as Parameters<typeof t>[0];
      return t.has(key) ? t(key) : t("UNKNOWN");
    },
  });
  if (response.status === 303) revalidatePath("/admin/products", "layout");
  return response;
}
