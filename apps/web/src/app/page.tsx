import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";

const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";

export default async function PlatformHome() {
  const t = await getTranslations("common");
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--brand)]">{t("appName")}</p>
        <LocaleSwitcher />
      </div>
      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("heroTitle")}</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">{t("heroBody")}</p>
        <Link
          href="/signup"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-[var(--brand)] px-6 font-medium text-white hover:brightness-110 sm:w-fit"
        >
          {t("openStore")}
        </Link>
      </header>

      <section className="flex flex-col gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{t("demoStores")}</h2>
        <ul className="list-disc pl-5">
          {["dhaka-fashion", "rajshahi-mango"].map((s) => (
            <li key={s}>
              <a className="underline" href={`http://${s}.${rootDomain}`}>
                {s}.{rootDomain}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
