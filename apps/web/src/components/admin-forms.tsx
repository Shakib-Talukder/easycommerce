"use client";

import { Label } from "@repo/ui";
import { useActionState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { sendLoginCodeAction, verifyLoginCodeAction } from "@/server/actions/auth";
import { updateSettingsAction } from "@/server/actions/settings";
import { inviteStaffAction } from "@/server/actions/staff";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function LoginForm({ lang }: { lang: Lang }) {
  const [state, action] = useActionState(sendLoginCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="identifier"
        label={t(lang, "login.identifier")}
        state={state}
        placeholder="01711000000"
        autoComplete="username"
        required
      />
      <SubmitButton>{t(lang, "login.send")}</SubmitButton>
    </form>
  );
}

export function VerifyForm({ lang, identifier }: { lang: Lang; identifier: string }) {
  const [state, action] = useActionState(verifyLoginCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="identifier" value={identifier} />
      <Field
        name="code"
        label={t(lang, "verify.code")}
        state={state}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
      />
      <SubmitButton>{t(lang, "verify.submit")}</SubmitButton>
    </form>
  );
}

export function InviteForm({ lang }: { lang: Lang }) {
  const [state, action] = useActionState(inviteStaffAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label={t(lang, "staff.name")} state={state} required />
      <Field
        name="identifier"
        label={t(lang, "login.identifier")}
        state={state}
        placeholder="01811000000"
        required
      />
      <SubmitButton>{t(lang, "staff.send")}</SubmitButton>
    </form>
  );
}

export type SettingsValues = {
  primaryColor: string;
  language: Lang;
  contactPhone: string;
  contactEmail: string;
  address: string;
  deliveryChargeInsideDhaka: string;
  deliveryChargeOutsideDhaka: string;
  codEnabled: boolean;
};

export function SettingsForm({ lang, values }: { lang: Lang; values: SettingsValues }) {
  const [state, action] = useActionState(updateSettingsAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="primaryColor"
        label={t(lang, "settings.primaryColor")}
        state={state}
        defaultValue={values.primaryColor}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="f-language">{t(lang, "settings.language")}</Label>
        <select
          id="f-language"
          name="language"
          defaultValue={values.language}
          className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="bn">বাংলা</option>
          <option value="en">English</option>
        </select>
      </div>
      <Field
        name="contactPhone"
        label={t(lang, "settings.contactPhone")}
        state={state}
        defaultValue={values.contactPhone}
      />
      <Field
        name="contactEmail"
        label={t(lang, "settings.contactEmail")}
        state={state}
        type="email"
        defaultValue={values.contactEmail}
      />
      <Field name="address" label={t(lang, "settings.address")} state={state} defaultValue={values.address} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="deliveryChargeInsideDhaka"
          label={t(lang, "settings.inside")}
          state={state}
          inputMode="decimal"
          defaultValue={values.deliveryChargeInsideDhaka}
        />
        <Field
          name="deliveryChargeOutsideDhaka"
          label={t(lang, "settings.outside")}
          state={state}
          inputMode="decimal"
          defaultValue={values.deliveryChargeOutsideDhaka}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="codEnabled" defaultChecked={values.codEnabled} className="size-4" />
        {t(lang, "settings.cod")}
      </label>
      <SubmitButton>{t(lang, "settings.save")}</SubmitButton>
    </form>
  );
}
