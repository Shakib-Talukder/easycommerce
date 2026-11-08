"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { addFeaturedAction } from "@/server/actions/catalog";
import { FormMessage } from "../form-bits";

/** Picks a product to add to Featured (FEATURED_LIMIT is reported by the server). */
export function AddFeaturedForm({ options }: { options: { id: string; label: string }[] }) {
  const t = useTranslations("catalog.featured");
  const [state, action] = useActionState(addFeaturedAction, null);
  return (
    <form action={action} className="flex flex-col gap-2" data-add-featured>
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {t("choose")}
          <select
            name="productId"
            required
            className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">{t("choose")}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md bg-[var(--brand)] px-4 text-sm font-medium text-white"
        >
          {t("add")}
        </button>
      </div>
    </form>
  );
}
