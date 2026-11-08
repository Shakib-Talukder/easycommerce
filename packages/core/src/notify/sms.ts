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

// ---------------------------------------------------------------------------
// BulkSMSBD
// ---------------------------------------------------------------------------

/**
 * BulkSMSBD's HTTP API. Their official docs sit behind a customer login, so this
 * follows the commonly documented shape:
 *
 *   GET {SMS_API_URL}?api_key=…&type=text&number=8801XXXXXXXXX&senderid=…&message=…
 *   → {"response_code":202,"message_id":…,"success_message":"…","error_message":""}
 *
 * 202 is success. Check the codes below against your account's docs before going live.
 */
export const BULKSMSBD_DEFAULT_URL = "https://bulksmsbd.net/api/smsapi";
export const BULKSMSBD_SUCCESS = 202;
export const SMS_TIMEOUT_MS = 10_000;

export type SmsErrorCode =
  | "SMS_INVALID_NUMBER"
  | "SMS_SENDER_ID"
  | "SMS_BAD_REQUEST"
  | "SMS_BALANCE"
  | "SMS_ACCOUNT"
  | "SMS_IP_NOT_ALLOWED"
  | "SMS_GATEWAY_ERROR"
  | "SMS_BAD_RESPONSE"
  | "SMS_TIMEOUT"
  | "SMS_NETWORK";

/** Known BulkSMSBD response codes → our error codes. */
export const BULKSMSBD_ERRORS: Record<number, { code: SmsErrorCode; meaning: string }> = {
  1001: { code: "SMS_INVALID_NUMBER", meaning: "Invalid number" },
  1002: { code: "SMS_SENDER_ID", meaning: "Sender ID not correct or disabled" },
  1003: { code: "SMS_BAD_REQUEST", meaning: "Required fields missing" },
  1005: { code: "SMS_GATEWAY_ERROR", meaning: "Internal error" },
  1006: { code: "SMS_BALANCE", meaning: "Balance validity not available" },
  1007: { code: "SMS_BALANCE", meaning: "Insufficient balance" },
  1011: { code: "SMS_ACCOUNT", meaning: "User ID not found" },
  1012: { code: "SMS_SENDER_ID", meaning: "Masking SMS must be sent in Bengali" },
  1013: { code: "SMS_SENDER_ID", meaning: "Sender ID has no gateway for this API key" },
  1014: { code: "SMS_SENDER_ID", meaning: "Sender type name not found for this sender" },
  1015: { code: "SMS_SENDER_ID", meaning: "Sender ID has no valid gateway for this API key" },
  1016: { code: "SMS_SENDER_ID", meaning: "No active price for this sender type" },
  1017: { code: "SMS_SENDER_ID", meaning: "No price info for this sender type" },
  1018: { code: "SMS_ACCOUNT", meaning: "Account disabled" },
  1019: { code: "SMS_SENDER_ID", meaning: "Price for this sender type disabled" },
  1020: { code: "SMS_ACCOUNT", meaning: "Parent account not found" },
  1021: { code: "SMS_ACCOUNT", meaning: "Parent account has no active price" },
  1031: { code: "SMS_ACCOUNT", meaning: "Account not verified" },
  1032: { code: "SMS_IP_NOT_ALLOWED", meaning: "IP not whitelisted" },
};

export class SmsSendError extends Error {
  constructor(
    readonly code: SmsErrorCode,
    message: string,
    readonly gatewayCode?: number,
  ) {
    super(message);
    this.name = "SmsSendError";
  }
}

/** +8801XXXXXXXXX / 8801… / 01… → 8801XXXXXXXXX (what the gateway expects). */
export function toGatewayNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  const n = digits.startsWith("880") ? digits : digits.startsWith("0") ? `88${digits}` : digits;
  if (!/^8801[3-9]\d{8}$/.test(n)) throw new SmsSendError("SMS_INVALID_NUMBER", "Not a BD mobile number");
  return n;
}

/** 8801711000123 → 88017*****123, for logs. */
export const maskNumber = (n: string) => n.replace(/^(\d{5})\d+(\d{3})$/, "$1*****$2");

/** Connection-level failures: the request never reached the gateway, so a retry can't duplicate an SMS. */
const RETRYABLE_NETWORK = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function networkCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (error as { code?: string })?.code;
}

export type BulkSmsBdConfig = {
  apiKey: string;
  senderId: string;
  apiUrl: string;
  timeoutMs?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** Injected in tests. */
  log?: (line: string) => void;
};

export class BulkSmsBdProvider implements NotificationProvider {
  readonly name = "bulksmsbd";
  readonly channel = "sms";

  constructor(readonly config: BulkSmsBdConfig) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): BulkSmsBdProvider {
    const apiKey = env.SMS_API_KEY?.trim();
    const senderId = env.SMS_SENDER_ID?.trim();
    if (!apiKey || !senderId) throw new Error("SMS_PROVIDER=bulksmsbd needs SMS_API_KEY and SMS_SENDER_ID");
    return new BulkSmsBdProvider({
      apiKey,
      senderId,
      apiUrl: env.SMS_API_URL?.trim() || BULKSMSBD_DEFAULT_URL,
    });
  }

  private url(number: string, text: string): string {
    const url = new URL(this.config.apiUrl);
    // URLSearchParams percent-encodes UTF-8, so Bangla text arrives intact.
    url.search = new URLSearchParams({
      api_key: this.config.apiKey,
      type: "text",
      number,
      senderid: this.config.senderId,
      message: text,
    }).toString();
    return url.toString();
  }

  private async attempt(url: string): Promise<Response> {
    const f = this.config.fetch ?? fetch;
    try {
      return await f(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? SMS_TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new SmsSendError("SMS_TIMEOUT", "SMS gateway timed out");
      }
      const code = networkCode(error);
      throw Object.assign(new SmsSendError("SMS_NETWORK", `SMS gateway unreachable (${code ?? "network"})`), {
        retryable: code !== undefined && RETRYABLE_NETWORK.has(code),
      });
    }
  }

  /** Sends one SMS. Retries once, only when the gateway couldn't be reached at all. */
  async send({ to, text }: OutgoingMessage): Promise<{ messageId: string | null }> {
    const number = toGatewayNumber(to);
    const url = this.url(number, text);
    let response: Response;
    try {
      response = await this.attempt(url);
    } catch (error) {
      if (!(error as { retryable?: boolean }).retryable) throw error;
      response = await this.attempt(url);
    }

    const body = await response.text();
    let code: number;
    let messageId: string | null = null;
    let detail = "";
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      const json = parsed as {
        response_code?: number | string;
        message_id?: number | string;
        error_message?: string;
      };
      code = Number(json.response_code);
      messageId = json.message_id === undefined || json.message_id === null ? null : String(json.message_id);
      detail = json.error_message ?? "";
    } catch {
      code = Number(body.trim()); // some endpoints answer with a bare code
    }

    const log = this.config.log ?? ((line: string) => console.info(line));
    if (code === BULKSMSBD_SUCCESS) {
      // Never the text (it holds the OTP) or the API key.
      log(`[sms:bulksmsbd] sent id=${messageId ?? "?"} to=${maskNumber(number)}`);
      return { messageId };
    }
    if (!Number.isFinite(code)) {
      throw new SmsSendError("SMS_BAD_RESPONSE", `Unexpected SMS gateway response (HTTP ${response.status})`);
    }
    const known = BULKSMSBD_ERRORS[code];
    log(`[sms:bulksmsbd] rejected code=${code} to=${maskNumber(number)}`);
    throw new SmsSendError(
      known?.code ?? "SMS_GATEWAY_ERROR",
      `SMS gateway rejected the message: ${code} ${known?.meaning ?? detail}`.trim(),
      code,
    );
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Throws in production when SMS_PROVIDER=console, unless ALLOW_CONSOLE_SMS=true
 * (then it warns loudly). Called at server startup (instrumentation.ts) and on
 * every provider lookup.
 */
export function assertSmsConfig(env: NodeJS.ProcessEnv = process.env): void {
  const name = env.SMS_PROVIDER?.trim() || "console";
  if (!SMS_PROVIDERS.includes(name as SmsProviderName)) {
    throw new Error(`Unknown SMS_PROVIDER "${name}". Expected one of: ${SMS_PROVIDERS.join(", ")}`);
  }
  if (name === "bulksmsbd") {
    BulkSmsBdProvider.fromEnv(env);
    return;
  }
  if (!isProduction()) return;
  if (env.ALLOW_CONSOLE_SMS !== "true") {
    throw new Error(
      "SMS_PROVIDER=console is refused in production (OTPs would only reach the server log). " +
        "Set SMS_PROVIDER=bulksmsbd, or ALLOW_CONSOLE_SMS=true for a local `next start`.",
    );
  }
  warnOnce(
    "sms-console-prod",
    "[sms] WARNING: SMS_PROVIDER=console with ALLOW_CONSOLE_SMS=true in production. " +
      "No SMS is sent; every OTP is written to the server log. Never do this on a public deployment.",
  );
}

export function getSmsProvider(
  name: string = process.env.SMS_PROVIDER?.trim() || "console",
): NotificationProvider {
  switch (name as SmsProviderName) {
    case "console":
      assertSmsConfig({ ...process.env, SMS_PROVIDER: "console" });
      return new ConsoleSmsProvider();
    case "bulksmsbd":
      return BulkSmsBdProvider.fromEnv();
    default:
      throw new Error(`Unknown SMS_PROVIDER "${name}". Expected one of: ${SMS_PROVIDERS.join(", ")}`);
  }
}
