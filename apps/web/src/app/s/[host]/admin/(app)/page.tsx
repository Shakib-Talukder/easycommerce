import { catalogStats } from "@repo/core";
import { forStore } from "@repo/db";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { primaryLink, secondaryLink } from "@/components/catalog/catalog-nav";
import { requireUser } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dashboard"))("metaTitle") };
}

/** Midnight in Asia/Dhaka (UTC+6, no DST) as a UTC instant. */
function startOfTodayInDhaka(now = new Date()): Date {
  const offsetMs = 6 * 60 * 60 * 1000;
  const dhaka = new Date(now.getTime() + offsetMs);
  dhaka.setUTCHours(0, 0, 0, 0);
  return new Date(dhaka.getTime() - offsetMs);
}

export default async function DashboardPage() {
  const { store, user } = await requireUser();
  const db = forStore(store.id);
  const [products, orders, customers, today, catalog, t, tc, format] = await Promise.all([
    db.product.count({ where: { deletedAt: null } }),
    db.order.count(),
    db.customer.count({ where: { deletedAt: null } }),
    db.order.count({ where: { createdAt: { gte: startOfTodayInDhaka() } } }),
    catalogStats(store.id),
    getTranslations("dashboard"),
    getTranslations("catalog.nav"),
    getFormatter(),
  ]);
  const stats = [
    { key: "products", label: t("products"), value: products, href: "/admin/products" },
    {
      key: "activeProducts",
      label: t("activeProducts"),
      value: catalog.active,
      href: "/admin/products?status=ACTIVE",
    },
    {
      key: "outOfStock",
      label: t("outOfStockVariants"),
      value: catalog.outOfStock,
      href: "/admin/products?stock=out",
      warn: catalog.outOfStock > 0,
    },
    { key: "orders", label: t("orders"), value: orders },
    { key: "customers", label: t("customers"), value: customers },
    { key: "today", label: t("today"), value: today },
  ];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold break-words">{t("welcome", { name: user.name })}</h1>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((s) => {
          const body = (
            <Card className="h-full" data-stat={s.key} data-value={s.value}>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-sm font-medium text-neutral-500">
                  <dt>{s.label}</dt>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {/* Bangla digits in bn (Intl via next-intl's formatter). */}
                <dd className={`text-3xl font-bold ${s.warn ? "text-red-600 dark:text-red-400" : ""}`}>
                  {format.number(s.value)}
                </dd>
              </CardContent>
            </Card>
          );
          return s.href ? (
            <Link key={s.key} href={s.href} className="block min-h-11 hover:opacity-90">
              {body}
            </Link>
          ) : (
            <div key={s.key}>{body}</div>
          );
        })}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/products/new" className={primaryLink}>
          {tc("newProduct")}
        </Link>
        <Link href="/admin/products" className={secondaryLink}>
          {tc("products")}
        </Link>
        <Link href="/admin/categories" className={secondaryLink}>
          {tc("categories")}
        </Link>
      </div>
    </section>
  );
}
