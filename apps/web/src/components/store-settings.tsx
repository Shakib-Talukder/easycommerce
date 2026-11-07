"use client";

import { AA_CONTRAST, PALETTES, contrastRatio } from "@repo/core/color";
import { DIVISIONS, findDivision } from "@repo/core/locations";
import { Button, Input, Label, cn } from "@repo/ui";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ActionState } from "@/lib/action-result";
import { saveSectionAction, uploadLogoAction } from "@/server/actions/store-settings";
import type { StoreSettingsValues } from "@/server/store-settings";
import {
  Field,
  FieldMessage,
  FormMessage,
  SelectField,
  SubmitButton,
  Toast,
  Toggle,
  fieldErrorsOf,
} from "./form-bits";

/*
 * One component per settings section, shared by the onboarding wizard
 * (mode="onboarding": Back / Skip / Next) and /admin/settings (mode="settings":
 * Save + toast). Validation lives in @repo/core (parseSection) for both.
 */

export type SectionMode =
  | { kind: "onboarding"; step: number; returnTo?: "finish"; skippable?: boolean }
  | { kind: "settings" };

type SectionProps = { values: StoreSettingsValues; mode: SectionMode };

/** Lets the settings tabs know about unsaved edits. */
export const DirtyContext = createContext<{ setDirty: (dirty: boolean) => void }>({ setDirty: () => {} });

function SectionForm({
  section,
  mode,
  children,
}: {
  section: "identity" | "branding" | "payments" | "delivery";
  mode: SectionMode;
  children: (state: ActionState) => ReactNode;
}) {
  const t = useTranslations("common");
  const [state, action] = useActionState(saveSectionAction, null);
  const { setDirty } = useContext(DirtyContext);
  useEffect(() => {
    if (state?.ok) setDirty(false);
  }, [state, setDirty]);

  return (
    <form
      action={action}
      className="flex flex-col gap-5"
      noValidate
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      data-section={section}
    >
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="mode" value={mode.kind} />
      {mode.kind === "onboarding" && mode.returnTo ? (
        <input type="hidden" name="return" value="finish" />
      ) : null}
      <FormMessage state={state} hideSuccess={mode.kind === "settings"} />
      {children(state)}
      {mode.kind === "settings" ? (
        <>
          <SubmitButton className="sm:w-fit">{t("save")}</SubmitButton>
          <Toast state={state} />
        </>
      ) : (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          {mode.step > 1 ? (
            <Link
              href={`/admin/onboarding?step=${mode.step - 1}`}
              className="inline-flex h-12 items-center justify-center rounded-md border border-neutral-300 px-6 text-base font-medium dark:border-neutral-700"
            >
              {t("back")}
            </Link>
          ) : null}
          {mode.skippable ? (
            <Button type="submit" name="intent" value="skip" variant="ghost" size="lg" formNoValidate>
              {t("skip")}
            </Button>
          ) : null}
          <SubmitButton name="intent" value="save" className="sm:ml-auto sm:w-fit">
            {t("next")}
          </SubmitButton>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// 1. Identity
// ---------------------------------------------------------------------------

export function IdentitySection({ values, mode }: SectionProps) {
  const t = useTranslations("settings.identity");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [division, setDivision] = useState(values.addressDivision);
  const divisionDistricts = findDivision(division)?.districts;

  return (
    <SectionForm section="identity" mode={mode}>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="nameBn" label={t("nameBn")} state={state} defaultValue={values.nameBn} required />
            <Field name="nameEn" label={t("nameEn")} state={state} defaultValue={values.nameEn} required />
            <Field
              name="taglineBn"
              label={t("taglineBn")}
              state={state}
              defaultValue={values.taglineBn}
              maxLength={160}
              optional
            />
            <Field
              name="taglineEn"
              label={t("taglineEn")}
              state={state}
              defaultValue={values.taglineEn}
              maxLength={160}
              optional
            />
            <Field
              name="contactPhone"
              label={t("contactPhone")}
              state={state}
              defaultValue={values.contactPhone}
              type="tel"
              inputMode="tel"
              required
            />
            <Field
              name="contactEmail"
              label={t("contactEmail")}
              state={state}
              defaultValue={values.contactEmail}
              type="email"
              optional
            />
            <SelectField
              name="addressDivision"
              label={t("division")}
              state={state}
              value={division}
              onChange={(e) => setDivision(e.target.value)}
            >
              <option value="">{t("chooseDivision")}</option>
              {DIVISIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d[locale]}
                </option>
              ))}
            </SelectField>
            <SelectField
              key={division}
              name="addressDistrict"
              label={t("district")}
              state={state}
              defaultValue={division === values.addressDivision ? values.addressDistrict : ""}
            >
              <option value="">{t("chooseDistrict")}</option>
              {divisionDistricts
                ? divisionDistricts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d[locale]}
                    </option>
                  ))
                : // No division yet (or no JavaScript): every district, grouped by division.
                  DIVISIONS.map((dv) => (
                    <optgroup key={dv.id} label={dv[locale]}>
                      {dv.districts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d[locale]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
            </SelectField>
            <Field
              name="addressArea"
              label={t("area")}
              state={state}
              defaultValue={values.addressArea}
              optional
            />
            <Field name="address" label={t("address")} state={state} defaultValue={values.address} optional />
          </div>
          <SelectField name="language" label={t("language")} state={state} defaultValue={values.language}>
            <option value="bn">{tc("locales.bn")}</option>
            <option value="en">{tc("locales.en")}</option>
          </SelectField>
        </>
      )}
    </SectionForm>
  );
}

// ---------------------------------------------------------------------------
// 2. Logo and colours
// ---------------------------------------------------------------------------

export function BrandingSection({ values, mode }: SectionProps) {
  const t = useTranslations("settings.branding");
  const locale = useLocale();
  const [primary, setPrimary] = useState(values.primaryColor);
  const [secondary, setSecondary] = useState(values.secondaryColor || values.primaryColor);
  const upload = useActionState(uploadLogoAction, null);
  const uploaded = upload[0]?.ok ? upload[0].data : undefined;
  const logoUrl = uploaded ? String(uploaded.logoUrl) : values.logoUrl;
  const suggested = uploaded ? String(uploaded.suggestedColor) : null;
  const name = locale === "en" ? values.nameEn : values.nameBn;

  return (
    <div className="flex flex-col gap-6">
      <LogoUpload logoUrl={logoUrl} upload={upload} />
      <SectionForm section="branding" mode={mode}>
        {(state) => (
          <>
            {suggested && suggested !== primary ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <span className="size-6 rounded-full border" style={{ background: suggested }} aria-hidden />
                <span>{t("suggested")}</span>
                <code>{suggested}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => setPrimary(suggested)}>
                  {t("useSuggested")}
                </Button>
              </div>
            ) : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("palettes")}</legend>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={t("palette", { name: p.id })}
                    aria-pressed={primary === p.primary && secondary === p.secondary}
                    onClick={() => {
                      setPrimary(p.primary);
                      setSecondary(p.secondary);
                    }}
                    className="flex h-10 overflow-hidden rounded-md border-2 border-transparent aria-pressed:border-neutral-900 dark:aria-pressed:border-white"
                  >
                    <span className="flex-1" style={{ background: p.primary }} />
                    <span className="w-1/3" style={{ background: p.secondary }} />
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                name="primaryColor"
                label={t("primaryColor")}
                value={primary}
                onChange={setPrimary}
                state={state}
              />
              <ColorField
                name="secondaryColor"
                label={t("secondaryColor")}
                value={secondary}
                onChange={setSecondary}
                state={state}
              />
            </div>
            <ContrastWarning color={primary} />
            <StorefrontPreview name={name} logoUrl={logoUrl} primary={primary} secondary={secondary} />
          </>
        )}
      </SectionForm>
    </div>
  );
}

function LogoUpload({
  logoUrl,
  upload: [state, action, pending],
}: {
  logoUrl: string | null;
  upload: [ActionState, (formData: FormData) => void, boolean];
}) {
  const t = useTranslations("settings.branding");
  const [preview, setPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  // The chosen file shows instantly while uploading; afterwards, the stored logo (unchanged if rejected).
  const shown = pending ? (preview ?? logoUrl) : logoUrl;
  const errors = state && !state.ok ? [state.message] : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2" data-logo-upload>
      <Label htmlFor="f-logo">{t("logo")}</Label>
      <div className="flex items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: preview or the uploaded file
            <img src={shown} alt="" className={cn("size-full object-contain", pending && "opacity-50")} />
          ) : (
            <span className="px-1 text-center text-[10px] text-neutral-400">{t("noLogo")}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <input
            id="f-logo"
            name="logo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="f-logo-msg"
            className="max-w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-2 dark:file:bg-neutral-800"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPreview(URL.createObjectURL(file)); // instant preview while uploading
              formRef.current?.requestSubmit();
            }}
          />
          <Button type="submit" variant="outline" size="sm" className="w-fit" disabled={pending}>
            {pending ? t("uploading") : t("uploadLogo")}
          </Button>
        </div>
      </div>
      <FieldMessage id="f-logo-msg" errors={errors} hint={state?.ok ? state.message : t("logoHint")} />
    </form>
  );
}

function ColorField({
  name,
  label,
  value,
  onChange,
  state,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  state: ActionState;
}) {
  const errors = fieldErrorsOf(state, name);
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={label}
          value={valid ? value.toLowerCase() : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-neutral-300 bg-white p-1 dark:border-neutral-700"
        />
        <Input
          id={`f-${name}`}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          invalid={Boolean(errors)}
          aria-describedby={`f-${name}-msg`}
          className="font-mono"
          maxLength={7}
          spellCheck={false}
        />
      </div>
      <FieldMessage id={`f-${name}-msg`} errors={errors} />
    </div>
  );
}

/** Warns (doesn't block) when white text on the primary colour fails WCAG AA. */
function ContrastWarning({ color }: { color: string }) {
  const t = useTranslations("settings.branding");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const ratio = contrastRatio(color, "#ffffff");
  if (ratio >= AA_CONTRAST) return null;
  return (
    <p
      role="status"
      data-contrast-warning
      className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      {t("contrastWarning", { ratio: ratio.toFixed(1) })}
    </p>
  );
}

function StorefrontPreview({
  name,
  logoUrl,
  primary,
  secondary,
}: {
  name: string;
  logoUrl: string | null;
  primary: string;
  secondary: string;
}) {
  const t = useTranslations("settings.branding");
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{t("preview")}</figcaption>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800">
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: primary, color: "#fff" }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview of the uploaded logo
            <img src={logoUrl} alt="" className="size-8 rounded bg-white object-contain" />
          ) : null}
          <span className="truncate font-bold">{name}</span>
        </div>
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{t("previewProduct")}</p>
            <p className="text-sm font-semibold" style={{ color: primary }}>
              ৳১,৮৫০
            </p>
          </div>
          <span
            className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-white"
            style={{ background: primary, boxShadow: `inset 0 -3px 0 ${secondary}` }}
          >
            {t("previewButton")}
          </span>
        </div>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// 3. Payments
// ---------------------------------------------------------------------------

export function PaymentsSection({ values, mode }: SectionProps) {
  const t = useTranslations("settings.payments");
  return (
    <SectionForm section="payments" mode={mode}>
      {(state) => {
        const methodErrors = fieldErrorsOf(state, "paymentMethods");
        return (
          <>
            {methodErrors ? (
              <p role="alert" data-field-error className="text-sm text-red-600 dark:text-red-400">
                {methodErrors[0]}
              </p>
            ) : (
              <p className="text-sm text-neutral-500">{t("atLeastOne")}</p>
            )}
            <Toggle
              name="codEnabled"
              label={t("cod")}
              hint={t("codHint")}
              defaultChecked={values.codEnabled}
            />
            <WalletFields wallet="bkash" values={values} state={state} />
            <WalletFields wallet="nagad" values={values} state={state} />
          </>
        );
      }}
    </SectionForm>
  );
}

function WalletFields({
  wallet,
  values,
  state,
}: {
  wallet: "bkash" | "nagad";
  values: StoreSettingsValues;
  state: ActionState;
}) {
  const t = useTranslations("settings.payments");
  const [enabled, setEnabled] = useState(values[`${wallet}Enabled`]);
  const label = t(wallet);
  return (
    <div className="flex flex-col gap-3">
      <Toggle name={`${wallet}Enabled`} label={label} checked={enabled} onChange={setEnabled} />
      <div hidden={!enabled} className="flex flex-col gap-3 pl-1 sm:pl-8">
        <p className="text-xs text-neutral-500">{t("walletNote")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name={`${wallet}Number`}
            label={t("walletNumber", { wallet: label })}
            state={state}
            defaultValue={values[`${wallet}Number`]}
            type="tel"
            inputMode="tel"
            placeholder="01711000000"
          />
          <SelectField
            name={`${wallet}AccountType`}
            label={t("accountType")}
            state={state}
            defaultValue={values[`${wallet}AccountType`]}
          >
            <option value="">{t("chooseAccountType")}</option>
            {(["PERSONAL", "AGENT", "MERCHANT"] as const).map((type) => (
              <option key={type} value={type}>
                {t(`accountTypes.${type}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Delivery
// ---------------------------------------------------------------------------

export function DeliverySection({ values, mode }: SectionProps) {
  const t = useTranslations("settings.delivery");
  return (
    <SectionForm section="delivery" mode={mode}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="deliveryChargeInsideDhaka"
            label={t("inside")}
            state={state}
            defaultValue={values.deliveryChargeInsideDhaka}
            inputMode="decimal"
            required
          />
          <Field
            name="deliveryChargeOutsideDhaka"
            label={t("outside")}
            state={state}
            defaultValue={values.deliveryChargeOutsideDhaka}
            inputMode="decimal"
            required
          />
          <Field
            name="freeDeliveryThreshold"
            label={t("freeThreshold")}
            state={state}
            defaultValue={values.freeDeliveryThreshold}
            inputMode="decimal"
            optional
            className="sm:col-span-2"
          />
          <Field
            name="deliveryDaysInsideDhaka"
            label={t("daysInside")}
            state={state}
            defaultValue={values.deliveryDaysInsideDhaka}
            inputMode="numeric"
            optional
          />
          <Field
            name="deliveryDaysOutsideDhaka"
            label={t("daysOutside")}
            state={state}
            defaultValue={values.deliveryDaysOutsideDhaka}
            inputMode="numeric"
            optional
          />
        </div>
      )}
    </SectionForm>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

export function CopyButton({ text }: { text: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}
