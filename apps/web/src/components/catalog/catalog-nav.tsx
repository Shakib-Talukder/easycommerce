import { cn } from "@repo/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

const ITEMS = [
  { id: "products", href: "/admin/products" },
  { id: "categories", href: "/admin/categories" },
  { id: "featured", href: "/admin/products/featured" },
  { id: "trash", href: "/admin/products/trash" },
] as const;

/** Section tabs shared by the catalogue pages (scroll inside their own bar on small screens). */
export async function CatalogNav({ active }: { active: (typeof ITEMS)[number]["id"] }) {
  const t = await getTranslations("catalog.nav");
  return (
    <nav aria-label={t("products")} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={item.id === active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap",
                item.id === active
                  ? "border-[var(--brand)] text-[var(--brand)]"
                  : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100",
              )}
            >
              {t(item.id)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Title row with optional actions; wraps on small screens. */
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export const primaryLink =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--brand)] px-4 text-sm font-medium text-white hover:brightness-110";
export const secondaryLink =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700";
