import { isProduction, warnOnce } from "../env";
import type { NotificationProvider, OutgoingMessage } from "./types";

export const SMS_PROVIDERS = ["console", "bulksmsbd"] as const;
export type SmsProviderName = (typeof SMS_PROVIDERS)[number];

/** Default provider: prints the SMS (and any OTP in it) to the server log. */
export class ConsoleSmsProvider implements NotificationProvider {
  readonly name = "console";
  readonly channel = "sms";

  async send({ to, text }: OutgoingMessage) {
    console.info(`[sms:console] to=${to} ${text}`);
  }
}

export type BulkSmsBdConfig = { apiKey: string; senderId: string; baseUrl: string };

/**
 * Typed stub for a Bangladeshi SMS gateway (BulkSMSBD-style HTTP API).
 * Configuration is validated now; the HTTP call is wired up when we pick a vendor.
 */
export class BulkSmsBdProvider implements NotificationProvider {
  readonly name = "bulksmsbd";
  readonly channel = "sms";

  constructor(readonly config: BulkSmsBdConfig) {}

  static fromEnv(): BulkSmsBdProvider {
    const apiKey = process.env.SMS_API_KEY;
    const senderId = process.env.SMS_SENDER_ID;
    if (!apiKey || !senderId) throw new Error("SMS_PROVIDER=bulksmsbd needs SMS_API_KEY and SMS_SENDER_ID");
    return new BulkSmsBdProvider({
      apiKey,
      senderId,
      baseUrl: process.env.SMS_BASE_URL ?? "https://bulksmsbd.net/api/smsapi",
    });
  }

  async send(_message: OutgoingMessage): Promise<void> {
    // TODO(day-2+): POST { api_key, senderid, number: to without "+", message: text } and check the response code.
    throw new Error("BulkSmsBdProvider.send is not implemented yet");
  }
}

export function getSmsProvider(name: string = process.env.SMS_PROVIDER ?? "console"): NotificationProvider {
  switch (name as SmsProviderName) {
    case "console":
      if (isProduction()) {
        warnOnce(
          "sms-console-prod",
          "[sms] SMS_PROVIDER=console in production: OTPs are written to the server log.",
        );
      }
      return new ConsoleSmsProvider();
    case "bulksmsbd":
      return BulkSmsBdProvider.fromEnv();
    default:
      throw new Error(`Unknown SMS_PROVIDER "${name}". Expected one of: ${SMS_PROVIDERS.join(", ")}`);
  }
}
