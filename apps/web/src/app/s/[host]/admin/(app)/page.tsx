import { forStore } from "@repo/db";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "Dashboard" };

/** Midnight in Asia/Dhaka (UTC+6, no DST) as a UTC instant. */
function startOfTodayInDhaka(now = new Date()): Date {
  const offsetMs = 6 * 60 * 60 * 1000;
  const dhaka = new Date(now.getTime() + offsetMs);
  dhaka.setUTCHours(0, 0, 0, 0);
  return new Date(dhaka.getTime() - offsetMs);
}

export default async function DashboardPage() {
  const { store, user } = await requireUser();
  const lang = store.language;
  const db = forStore(store.id);
  const [products, orders, customers, today] = await Promise.all([
    db.product.count({ where: { deletedAt: null } }),
    db.order.count(),
    db.customer.count({ where: { deletedAt: null } }),
    db.order.count({ where: { createdAt: { gte: startOfTodayInDhaka() } } }),
  ]);
  const number = new Intl.NumberFormat(lang === "bn" ? "bn-BD" : "en-BD");
  const stats = [
    { key: "products", label: t(lang, "dash.products"), value: products },
    { key: "orders", label: t(lang, "dash.orders"), value: orders },
    { key: "customers", label: t(lang, "dash.customers"), value: customers },
    { key: "today", label: t(lang, "dash.today"), value: today },
  ];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">
        {t(lang, "dash.welcome")}, {user.name}
      </h1>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.key} data-stat={s.key} data-value={s.value}>
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-sm font-medium text-neutral-500">
                <dt>{s.label}</dt>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <dd className="text-3xl font-bold">{number.format(s.value)}</dd>
            </CardContent>
          </Card>
        ))}
      </dl>
    </section>
  );
}
