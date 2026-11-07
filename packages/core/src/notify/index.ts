import type { Identifier } from "@repo/db/validation";
import { getEmailProvider } from "./email";
import { getSmsProvider } from "./sms";

export type { NotificationProvider, OutgoingMessage } from "./types";
export { ConsoleEmailProvider, SmtpEmailProvider, getEmailProvider } from "./email";
export { BulkSmsBdProvider, ConsoleSmsProvider, SMS_PROVIDERS, getSmsProvider } from "./sms";

export type OtpMessageInput = {
  to: Identifier;
  code: string;
  purpose: "SIGNUP" | "LOGIN" | "INVITE";
  storeName: string;
  language: "bn" | "en";
  ttlMinutes: number;
};

export function otpMessageText({ code, purpose, storeName, language, ttlMinutes }: OtpMessageInput): string {
  if (language === "bn") {
    const what = purpose === "SIGNUP" ? "দোকান খোলার" : purpose === "INVITE" ? "আমন্ত্রণ গ্রহণের" : "লগইনের";
    return `${storeName}: ${what} কোড ${code}। ${ttlMinutes} মিনিটের মধ্যে ব্যবহার করুন। কাউকে জানাবেন না।`;
  }
  const what = purpose === "SIGNUP" ? "store signup" : purpose === "INVITE" ? "staff invite" : "login";
  return `${storeName}: your ${what} code is ${code}. It expires in ${ttlMinutes} minutes. Don't share it.`;
}

/** Sends an OTP by email or SMS depending on the identifier. */
export async function sendOtpMessage(input: OtpMessageInput): Promise<void> {
  const text = otpMessageText(input);
  if (input.to.kind === "email") {
    const provider = await getEmailProvider();
    await provider.send({ to: input.to.value, subject: `${input.storeName} code: ${input.code}`, text });
  } else {
    await getSmsProvider().send({ to: input.to.value, text });
  }
}
