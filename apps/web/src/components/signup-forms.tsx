"use client";

import { Input, Label, cn } from "@repo/ui";
import { slugifySubdomain } from "@repo/db/validation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  createStoreAction,
  resendSignupCodeAction,
  sendSignupCodeAction,
  verifySignupCodeAction,
} from "@/server/actions/signup";
import { Field, FieldMessage, FormMessage, ResendCodeForm, SubmitButton, fieldErrorsOf } from "./form-bits";

// ---------------------------------------------------------------------------
// Screen 1: phone
// ---------------------------------------------------------------------------

export function PhoneForm() {
  const t = useTranslations("signup");
  const [state, action] = useActionState(sendSignupCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="phone"
        label={t("phoneLabel")}
        state={state}
        hint={t("phoneHint")}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="01711000000"
        required
        autoFocus
      />
      <SubmitButton>{t("sendCode")}</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Screen 2: OTP
// ---------------------------------------------------------------------------

const toAsciiDigits = (s: string) =>
  s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/\D/g, "");

/**
 * Six one-digit boxes with auto-advance, backspace-to-previous and paste of
 * the whole code. Posts `code`; each box is also named `digit`, so the form
 * still works without JavaScript.
 */
export function OtpInput({ invalid, describedBy }: { invalid?: boolean; describedBy?: string }) {
  const t = useTranslations("signup");
  const [digits, setDigits] = useState<string[]>(() => Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const fill = (start: number, value: string) => {
    const chars = toAsciiDigits(value)
      .slice(0, 6 - start)
      .split("");
    if (chars.length === 0) return;
    setDigits((prev) => {
      const next = [...prev];
      chars.forEach((c, i) => (next[start + i] = c));
      return next;
    });
    refs.current[Math.min(start + chars.length, 5)]?.focus();
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((prev) => prev.map((d, j) => (j === i - 1 ? "" : d)));
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(i, e.clipboardData.getData("text"));
  };

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="code" value={digits.join("")} />
      <div className="flex justify-between gap-2" role="group" aria-label={t("otpLabel")}>
        {digits.map((d, i) => (
          <Input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            name="digit"
            value={d}
            onChange={(e) => {
              const v = toAsciiDigits(e.target.value);
              if (v.length > 1) return fill(i, v); // autofill / fast typing
              setDigits((prev) => prev.map((x, j) => (j === i ? v : x)));
              if (v && i < 5) refs.current[i + 1]?.focus();
            }}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={6}
            aria-label={t("digitLabel", { n: i + 1 })}
            aria-describedby={describedBy}
            invalid={invalid}
            autoFocus={i === 0}
            className="h-12 w-11 px-0 text-center text-xl font-semibold sm:w-12"
          />
        ))}
      </div>
    </div>
  );
}

export function OtpForm({ phone, resendSeconds }: { phone: string; resendSeconds: number }) {
  const t = useTranslations("signup");
  const [state, action] = useActionState(verifySignupCodeAction, null);
  const codeErrors = fieldErrorsOf(state, "code");
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <FormMessage state={state} />
        <input type="hidden" name="phone" value={phone} />
        <Label>{t("otpLabel")}</Label>
        <OtpInput invalid={Boolean(codeErrors)} describedBy="f-code-msg" />
        <FieldMessage id="f-code-msg" errors={codeErrors} />
        <SubmitButton>{t("verify")}</SubmitButton>
      </form>
      <ResendCodeForm
        action={resendSignupCodeAction}
        fields={{ phone }}
        initialSeconds={resendSeconds}
        label={t("resend")}
        countdown={(seconds) => t("resendIn", { seconds })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3: store details
// ---------------------------------------------------------------------------

type Check = { available: boolean; reason: "FORMAT" | "RESERVED" | "TAKEN" | null; suggestions: string[] };

/** Debounced (400 ms) live check against GET /api/subdomain-check. */
function useSubdomainCheck(subdomain: string) {
  const [result, setResult] = useState<{ for: string; check: Check } | null>(null);
  useEffect(() => {
    if (!subdomain) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subdomain-check?s=${encodeURIComponent(subdomain)}`, {
          signal: controller.signal,
        });
        if (res.ok) setResult({ for: subdomain, check: (await res.json()) as Check });
      } catch {
        // Aborted or offline: the server re-checks on submit anyway.
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [subdomain]);
  return subdomain && result?.for === subdomain ? result.check : null;
}

export function StoreDetailsForm({ rootDomain }: { rootDomain: string }) {
  const t = useTranslations("signup");
  const [state, action] = useActionState(createStoreAction, null);
  const [nameEn, setNameEn] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [edited, setEdited] = useState(false);
  const check = useSubdomainCheck(subdomain);

  // Suggest a subdomain from the English name until the user types their own.
  const onNameEn = (value: string) => {
    setNameEn(value);
    if (!edited) setSubdomain(slugifySubdomain(value));
  };

  const serverErrors = fieldErrorsOf(state, "subdomain");
  const serverSuggestions = (state && !state.ok ? state.data?.suggestions : undefined) as
    | string[]
    | undefined;
  const suggestions = check?.suggestions.length ? check.suggestions : (serverSuggestions ?? []);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="nameBn" label={t("nameBn")} state={state} placeholder="নতুন দোকান" required autoFocus />
      <Field
        name="nameEn"
        label={t("nameEn")}
        state={state}
        placeholder="Notun Dokan"
        value={nameEn}
        onChange={(e) => onNameEn(e.target.value)}
        required
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="f-subdomain">{t("subdomain")}</Label>
        <Input
          id="f-subdomain"
          name="subdomain"
          value={subdomain}
          onChange={(e) => {
            setEdited(true);
            setSubdomain(e.target.value.toLowerCase().replace(/\s+/g, "-"));
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          placeholder="notun-dokan"
          invalid={Boolean(serverErrors) || (check ? !check.available : false)}
          aria-describedby="f-subdomain-msg f-subdomain-url"
          required
        />
        <p id="f-subdomain-url" className="text-xs text-neutral-500">
          {t("urlPreview")}:{" "}
          <span className="font-mono break-all text-neutral-800 dark:text-neutral-200" data-url-preview>
            https://{subdomain || "…"}.{rootDomain}
          </span>
        </p>
        <SubdomainStatus subdomain={subdomain} check={check} serverErrors={serverErrors} />
        {suggestions.length > 0 && (!check || !check.available) ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-neutral-500">{t("suggestions")}</span>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setEdited(true);
                  setSubdomain(s);
                }}
                className="rounded-full border border-neutral-300 px-3 py-1 font-mono text-xs hover:border-[var(--brand)] dark:border-neutral-700"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <SubmitButton>{t("create")}</SubmitButton>
    </form>
  );
}

function SubdomainStatus({
  subdomain,
  check,
  serverErrors,
}: {
  subdomain: string;
  check: Check | null;
  serverErrors?: string[];
}) {
  const t = useTranslations("signup");
  // A fresh live check wins over a server error for an older value.
  if (!check && serverErrors) return <FieldMessage id="f-subdomain-msg" errors={serverErrors} />;
  const text = !subdomain
    ? t("subdomainHint")
    : !check
      ? t("checking")
      : check.available
        ? t("available")
        : t(`reason.${check.reason ?? "FORMAT"}`);
  return (
    <p
      id="f-subdomain-msg"
      aria-live="polite"
      data-subdomain-status={check ? (check.available ? "available" : check.reason) : undefined}
      className={cn(
        "text-xs",
        check?.available && "text-green-700 dark:text-green-400",
        check && !check.available && "text-red-600 dark:text-red-400",
        !check && "text-neutral-500",
      )}
    >
      {text}
    </p>
  );
}
