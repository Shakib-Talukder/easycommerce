"use client";

import { useActionState } from "react";
import { startSignupAction, verifySignupAction } from "@/server/actions/signup";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function SignupForm({ rootDomain }: { rootDomain: string }) {
  const [state, action] = useActionState(startSignupAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="storeName"
        label="Store name / দোকানের নাম"
        state={state}
        placeholder="ঢাকা ফ্যাশন"
        required
      />
      <Field
        name="subdomain"
        label="Store address / সাবডোমেইন"
        state={state}
        placeholder="dhaka-fashion"
        hint={`yourname.${rootDomain}: 3–30 lowercase letters, digits or hyphens`}
        autoCapitalize="none"
        required
      />
      <Field
        name="identifier"
        label="Your email or mobile / ইমেইল বা মোবাইল"
        state={state}
        placeholder="01711000000"
        inputMode="email"
        autoComplete="username"
        required
      />
      <SubmitButton>Send code / কোড পাঠান</SubmitButton>
    </form>
  );
}

export function SignupVerifyForm({ subdomain, identifier }: { subdomain: string; identifier: string }) {
  const [state, action] = useActionState(verifySignupAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="subdomain" value={subdomain} />
      <input type="hidden" name="identifier" value={identifier} />
      <Field
        name="code"
        label="6-digit code / ৬ সংখ্যার কোড"
        state={state}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
      />
      <SubmitButton>Create store / দোকান খুলুন</SubmitButton>
    </form>
  );
}
