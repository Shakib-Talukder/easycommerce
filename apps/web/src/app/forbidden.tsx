import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function Forbidden() {
  const t = await getTranslations("common");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <p className="text-5xl font-bold text-neutral-300">403</p>
      <h1 className="text-xl font-semibold">{t("forbiddenTitle")}</h1>
      <p className="text-sm text-neutral-500">{t("forbiddenBody")}</p>
      <Link href="/admin" className="text-sm underline">
        {t("backToDashboard")}
      </Link>
    </div>
  );
}
