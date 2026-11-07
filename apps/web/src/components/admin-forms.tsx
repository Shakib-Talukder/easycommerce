"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { sendLoginCodeAction, verifyLoginCodeAction } from "@/server/actions/auth";
import { inviteStaffAction } from "@/server/actions/staff";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(sendLoginCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="identifier"
        label={t("identifier")}
        state={state}
        placeholder="01711000000"
        autoComplete="username"
        required
      />
      <SubmitButton>{t("sendCode")}</SubmitButton>
    </form>
  );
}

export function VerifyForm({ identifier }: { identifier: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState(verifyLoginCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="identifier" value={identifier} />
      <Field
        name="code"
        label={t("code")}
        state={state}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
      />
      <SubmitButton>{t("verifySubmit")}</SubmitButton>
    </form>
  );
}

export function InviteForm() {
  const t = useTranslations("staff");
  const ta = useTranslations("auth");
  const [state, action] = useActionState(inviteStaffAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label={t("name")} state={state} required />
      <Field name="identifier" label={ta("identifier")} state={state} placeholder="01811000000" required />
      <SubmitButton>{t("send")}</SubmitButton>
    </form>
  );
}
