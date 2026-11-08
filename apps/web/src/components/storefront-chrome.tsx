import { findDistrict, findDivision, readSocialLinks, type SocialLinks } from "@repo/core";
import { formatBDT, storeDisplayName, type StoreSettingsModel as StoreSettings } from "@repo/db";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

type Store = { nameBn: string; nameEn: string };
type Props = { store: Store; settings: StoreSettings };

/** +8801711000000 → 01711000000 (how numbers are written locally). */
const localPhone = (e164: string) => e164.replace(/^\+88/, "");

export function taglineOf(
  settings: Pick<StoreSettings, "language" | "taglineBn" | "taglineEn">,
): string | null {
  const [first, second] =
    settings.language === "en"
      ? [settings.taglineEn, settings.taglineBn]
      : [settings.taglineBn, settings.taglineEn];
  return first?.trim() || second?.trim() || null;
}

/** Store header: logo, name and tagline in the store's language. */
export async function StoreHeader({ store, settings }: Props) {
  const name = storeDisplayName(store, settings.language);
  const tagline = taglineOf(settings);
  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="flex min-h-11 min-w-0 items-center gap-3">
          {settings.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- immutable CDN/upload URL, already resized
            <img
              src={settings.logoUrl}
              alt=""
              width={40}
              height={40}
              className="size-10 shrink-0 rounded object-contain"
            />
          ) : null}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xl font-bold text-[var(--brand)]" data-store-name>
              {name}
            </span>
            {tagline ? (
              <span className="truncate text-sm text-neutral-500" data-store-tagline>
                {tagline}
              </span>
            ) : null}
          </span>
        </Link>
        {settings.contactPhone ? (
          <a
            href={`tel:${settings.contactPhone}`}
            className="flex min-h-11 shrink-0 items-center text-sm text-neutral-600 dark:text-neutral-400"
          >
            {localPhone(settings.contactPhone)}
          </a>
        ) : null}
      </div>
    </header>
  );
}

/** Footer: contact, address, payment methods, delivery charges, social links and WhatsApp. */
export async function StoreFooter({ store, settings }: Props) {
  const lang = settings.language;
  const [t, format] = await Promise.all([getTranslations("storefront"), getFormatter()]);
  const social = readSocialLinks(settings.socialLinks);
  const division = findDivision(settings.addressDivision);
  const district = findDistrict(settings.addressDivision, settings.addressDistrict);
  const address = [settings.address, settings.addressArea, district?.[lang], division?.[lang]]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  const badges = [
    settings.codEnabled && { id: "cod", label: t("cod") },
    settings.bkashEnabled && { id: "bkash", label: t("bkash") },
    settings.nagadEnabled && { id: "nagad", label: t("nagad") },
  ].filter((b): b is { id: string; label: string } => Boolean(b));
  const days = (n: number | null) => (n ? ` · ${t("deliveryDays", { count: n })}` : "");
  const name = storeDisplayName(store, lang);

  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
        <FooterBlock title={t("contact")}>
          {settings.contactPhone ? (
            <a href={`tel:${settings.contactPhone}`} className="flex min-h-11 items-center" data-footer-phone>
              {localPhone(settings.contactPhone)}
            </a>
          ) : null}
          {settings.contactEmail ? (
            <a
              href={`mailto:${settings.contactEmail}`}
              className="flex min-h-11 items-center break-all"
              data-footer-email
            >
              {settings.contactEmail}
            </a>
          ) : null}
          {address ? (
            <p data-footer-address>
              <span className="sr-only">{t("address")}: </span>
              {address}
            </p>
          ) : null}
        </FooterBlock>

        {badges.length > 0 ? (
          <FooterBlock title={t("paymentsAccepted")}>
            <ul className="flex flex-wrap gap-2" data-payment-badges>
              {badges.map((b) => (
                <li
                  key={b.id}
                  data-payment={b.id}
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {b.label}
                </li>
              ))}
            </ul>
          </FooterBlock>
        ) : null}

        <FooterBlock title={t("delivery")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-delivery>
            <dt>{t("insideDhaka")}</dt>
            <dd data-delivery-inside>
              {formatBDT(settings.deliveryChargeInsideDhaka, lang)}
              {days(settings.deliveryDaysInsideDhaka)}
            </dd>
            <dt>{t("outsideDhaka")}</dt>
            <dd data-delivery-outside>
              {formatBDT(settings.deliveryChargeOutsideDhaka, lang)}
              {days(settings.deliveryDaysOutsideDhaka)}
            </dd>
          </dl>
          {settings.freeDeliveryThreshold !== null ? (
            <p data-free-delivery>
              {t("freeDeliveryFrom", { amount: formatBDT(settings.freeDeliveryThreshold, lang) })}
            </p>
          ) : null}
        </FooterBlock>

        <SocialBlock social={social} title={t("followUs")} whatsappLabel={t("whatsappChat")} labels={t} />
      </div>
      <p className="border-t border-neutral-200 py-4 text-center text-xs dark:border-neutral-800">
        © {format.dateTime(new Date(), { year: "numeric" })} {name}
      </p>
    </footer>
  );
}

function FooterBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      {children}
    </section>
  );
}

type Labels = (key: `social.${"facebook" | "instagram" | "youtube" | "tiktok"}`) => string;

function SocialBlock({
  social,
  title,
  whatsappLabel,
  labels,
}: {
  social: SocialLinks;
  title: string;
  whatsappLabel: string;
  labels: Labels;
}) {
  const platforms = (["facebook", "instagram", "youtube", "tiktok"] as const).filter((p) => social[p]);
  if (platforms.length === 0 && !social.whatsapp) return null;
  return (
    <FooterBlock title={title}>
      {platforms.length > 0 ? (
        <ul className="flex flex-wrap gap-2" data-social-links>
          {platforms.map((p) => (
            <li key={p}>
              <a
                href={social[p]}
                target="_blank"
                rel="noopener noreferrer nofollow"
                aria-label={labels(`social.${p}`)}
                title={labels(`social.${p}`)}
                data-social={p}
                className="flex size-11 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:border-[var(--brand)] hover:text-[var(--brand)] dark:border-neutral-700 dark:text-neutral-300"
              >
                <SocialIcon platform={p} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {social.whatsapp ? (
        <a
          href={`https://wa.me/${social.whatsapp.replace(/^\+/, "")}`}
          target="_blank"
          rel="noopener noreferrer nofollow"
          data-whatsapp
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-[#128c7e] px-3 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          <SocialIcon platform="whatsapp" />
          {whatsappLabel}
        </a>
      ) : null}
    </FooterBlock>
  );
}

/** Simple line icons (not the platforms' logos), 18 px, currentColor. */
function SocialIcon({
  platform,
}: {
  platform: "facebook" | "instagram" | "youtube" | "tiktok" | "whatsapp";
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (platform) {
    case "facebook":
      return (
        <svg {...common}>
          <path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H7v3h2v8h3v-8h2.5l.5-3h-3V7a1 1 0 0 1 1-1h2z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="4" />
          <path d="m10 9 5 3-5 3z" fill="currentColor" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 3c.5 2.5 2.5 4.5 5 5" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" />
          <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z" />
        </svg>
      );
  }
}
