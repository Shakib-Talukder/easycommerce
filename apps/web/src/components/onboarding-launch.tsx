"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { launchStoreAction } from "@/server/actions/store-settings";
import { FormMessage, SubmitButton } from "./form-bits";

export function LaunchForm() {
  const t = useTranslations("onboarding");
  const [state, action] = useActionState(launchStoreAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" data-launch-form>
      <FormMessage state={state} />
      <SubmitButton>{t("launch")}</SubmitButton>
    </form>
  );
}
