"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { resendLoginCodeAction, sendLoginCodeAction, verifyLoginCodeAction } from "@/server/actions/auth";
import { inviteStaffAction } from "@/server/actions/staff";
import { Field, FormMessage, ResendCodeForm, SubmitButton } from "./form-bits";

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

export function VerifyForm({ identifier, resendSeconds }: { identifier: string; resendSeconds: number }) {
  const t = useTranslations("auth");
  return (
    <div className="flex flex-col gap-4">
      <VerifyCodeForm identifier={identifier} />
      <ResendCodeForm
        action={resendLoginCodeAction}
        fields={{ identifier }}
        initialSeconds={resendSeconds}
        label={t("resend")}
        countdown={(seconds) => t("resendIn", { seconds })}
      />
    </div>
  );
}

function VerifyCodeForm({ identifier }: { identifier: string }) {
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
