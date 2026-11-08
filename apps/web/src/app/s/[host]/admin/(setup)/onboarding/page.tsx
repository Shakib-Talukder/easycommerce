import {
  ONBOARDING_STEP_COUNT,
  SETTINGS_SECTIONS,
  findDistrict,
  findDivision,
  type SettingsSection,
} from "@repo/core";
import { formatBDT, takaToPoisha } from "@repo/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@repo/ui";
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { LaunchForm } from "@/components/onboarding-launch";
import {
  BrandingSection,
  DeliverySection,
  IdentitySection,
  PaymentsSection,
  type SectionMode,
} from "@/components/store-settings";
import { requireRole } from "@/server/auth";
import { loadSettingsValues, type StoreSettingsValues } from "@/server/store-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("onboarding"))("metaTitle") };
}

const FINISH = ONBOARDING_STEP_COUNT + 1;
const SECTION_COMPONENTS = {
  identity: IdentitySection,
  branding: BrandingSection,
  payments: PaymentsSection,
  delivery: DeliverySection,
} as const;

type Props = { searchParams: Promise<{ step?: string; return?: string }> };

/**
 * 4-step wizard + review. Each step is saved on Next; onboarding_step records
 * progress, so leaving and logging in again resumes at the next unfinished step.
 */
export default async function OnboardingPage({ searchParams }: Props) {
  const { store } = await requireRole("OWNER");
  if (store.onboardingCompleted) redirect("/admin");
  const { values, settings } = await loadSettingsValues(store.id);
  const [t, format] = await Promise.all([getTranslations("onboarding"), getFormatter()]);

  // Resume at the first unfinished step; earlier (finished) steps can be revisited, later ones can't.
  const resume = Math.min(settings.onboardingStep + 1, FINISH);
  const params = await searchParams;
  const requested = Number(params.step);
  const step = Number.isInteger(requested) && requested >= 1 && requested <= resume ? requested : resume;
  const section: SettingsSection | null = step <= ONBOARDING_STEP_COUNT ? SETTINGS_SECTIONS[step - 1]! : null;
  const done = settings.onboardingStep;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-onboarding-step={step}>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={ONBOARDING_STEP_COUNT}
            aria-valuenow={done}
            aria-label={t("progress", { done, total: ONBOARDING_STEP_COUNT })}
            className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
          >
            <div
              className="h-full bg-[var(--brand)] transition-all"
              style={{ width: `${(done / ONBOARDING_STEP_COUNT) * 100}%` }}
            />
          </div>
          <span className="shrink-0">{t("progress", { done, total: ONBOARDING_STEP_COUNT })}</span>
        </div>
        <ol className="grid grid-cols-5 gap-1 text-[11px] sm:text-xs">
          {[...SETTINGS_SECTIONS, "finish" as const].map((s, i) => {
            const n = i + 1;
            const reachable = n <= resume;
            const label = t(`steps.${s}`);
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border text-xs font-semibold",
                    n === step
                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                      : n <= done
                        ? "border-[var(--brand)] text-[var(--brand)]"
                        : "border-neutral-300 text-neutral-400 dark:border-neutral-700",
                  )}
                >
                  {n <= done && n !== step ? "✓" : format.number(n)}
                </span>
                <span className="line-clamp-2 text-center">{label}</span>
              </>
            );
            return (
              <li key={s} aria-current={n === step ? "step" : undefined}>
                {reachable && n !== step ? (
                  <Link
                    href={`/admin/onboarding?step=${n}`}
                    className="flex flex-col items-center gap-1 hover:text-[var(--brand)]"
                  >
                    {content}
                  </Link>
                ) : (
                  <span className="flex flex-col items-center gap-1">{content}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Card>
        <CardHeader>
          <p className="text-xs font-medium text-neutral-500">
            {t("stepOf", { current: step, total: FINISH })}
          </p>
          <CardTitle>{section ? t(`steps.${section}`) : t("finishTitle")}</CardTitle>
          <CardDescription>{section ? t(`intro.${section}`) : t("finishBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          {section ? (
            <StepForm
              section={section}
              values={values}
              mode={{
                kind: "onboarding",
                step,
                skippable: section === "branding",
                ...(params.return === "finish" && done >= ONBOARDING_STEP_COUNT
                  ? { returnTo: "finish" as const }
                  : {}),
              }}
            />
          ) : (
            <Review values={values} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StepForm({
  section,
  values,
  mode,
}: {
  section: SettingsSection;
  values: StoreSettingsValues;
  mode: SectionMode;
}) {
  const Component = SECTION_COMPONENTS[section];
  return <Component values={values} mode={mode} />;
}

async function Review({ values }: { values: StoreSettingsValues }) {
  const [t, ts, tc, locale] = await Promise.all([
    getTranslations("onboarding"),
    getTranslations("settings"),
    getTranslations("common"),
    getLocale(),
  ]);
  const notSet = <span className="text-neutral-400">{tc("notSet")}</span>;
  const taka = (v: string) => (v ? formatBDT(takaToPoisha(v), locale) : null);
  const wallet = (w: "bkash" | "nagad") =>
    values[`${w}Enabled`]
      ? `${ts(`payments.${w}`)}: ${values[`${w}Number`]}${
          values[`${w}AccountType`]
            ? ` (${ts(`payments.accountTypes.${values[`${w}AccountType`] as "PERSONAL" | "AGENT" | "MERCHANT"}`)})`
            : ""
        }`
      : null;
  const division = findDivision(values.addressDivision);
  const district = findDistrict(values.addressDivision, values.addressDistrict);
  const days = (v: string) => (v ? ts("delivery.days", { count: Number(v) }) : null);

  const groups: { section: SettingsSection; rows: [string, ReactNode][] }[] = [
    {
      section: "identity",
      rows: [
        [ts("identity.nameBn"), values.nameBn],
        [ts("identity.nameEn"), values.nameEn],
        [ts("identity.contactPhone"), values.contactPhone],
        [ts("identity.contactEmail"), values.contactEmail || null],
        [
          ts("identity.district"),
          [values.addressArea, district?.[locale], division?.[locale]].filter(Boolean).join(", ") || null,
        ],
        [ts("identity.language"), tc(`locales.${values.language}`)],
      ],
    },
    {
      section: "branding",
      rows: [
        [
          ts("branding.logo"),
          values.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded logo
            <img src={values.logoUrl} alt="" className="size-10 rounded object-contain" />
          ) : null,
        ],
        [
          ts("branding.primaryColor"),
          <span key="c" className="inline-flex items-center gap-2">
            <span className="size-4 rounded-full border" style={{ background: values.primaryColor }} />
            <code>{values.primaryColor}</code>
          </span>,
        ],
      ],
    },
    {
      section: "payments",
      rows: [
        [ts("payments.cod"), values.codEnabled ? tc("on") : tc("off")],
        [ts("payments.bkash"), wallet("bkash") ?? tc("off")],
        [ts("payments.nagad"), wallet("nagad") ?? tc("off")],
      ],
    },
    {
      section: "delivery",
      rows: [
        [
          ts("delivery.inside"),
          [taka(values.deliveryChargeInsideDhaka), days(values.deliveryDaysInsideDhaka)]
            .filter(Boolean)
            .join(" · "),
        ],
        [
          ts("delivery.outside"),
          [taka(values.deliveryChargeOutsideDhaka), days(values.deliveryDaysOutsideDhaka)]
            .filter(Boolean)
            .join(" · "),
        ],
        [ts("delivery.freeThreshold"), taka(values.freeDeliveryThreshold)],
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <section key={g.section} className="flex flex-col gap-2" data-review={g.section}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t(`steps.${g.section}`)}</h2>
            <Link
              href={`/admin/onboarding?step=${i + 1}&return=finish`}
              className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--brand)] underline"
            >
              {tc("edit")}
            </Link>
          </div>
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-sm">
            {g.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-neutral-500">{label}</dt>
                <dd className="min-w-0 break-words">{value ?? notSet}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <LaunchForm />
    </div>
  );
}
