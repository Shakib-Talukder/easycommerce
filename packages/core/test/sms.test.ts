import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BULKSMSBD_DEFAULT_URL,
  BulkSmsBdProvider,
  ConsoleSmsProvider,
  SmsSendError,
  assertSmsConfig,
  getSmsProvider,
  maskNumber,
  toGatewayNumber,
} from "../src/notify/sms";

afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function provider(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  const calls: string[] = [];
  const logs: string[] = [];
  const p = new BulkSmsBdProvider({
    apiKey: "test-key-123",
    senderId: "8809601000000",
    apiUrl: BULKSMSBD_DEFAULT_URL,
    timeoutMs,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      return fetchImpl(String(input), init);
    }) as typeof fetch,
    log: (l) => logs.push(l),
  });
  return { p, calls, logs };
}

const ok = {
  response_code: 202,
  message_id: 98765,
  success_message: "SMS Submitted Successfully",
  error_message: "",
};

describe("BulkSmsBdProvider", () => {
  it("sends GET api_key/type/number/senderid/message with 8801… and treats 202 as success", async () => {
    const { p, calls, logs } = provider(async () => json(ok));
    await expect(p.send({ to: "+8801711000123", text: "Code 123456" })).resolves.toEqual({
      messageId: "98765",
    });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(BULKSMSBD_DEFAULT_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: "test-key-123",
      type: "text",
      number: "8801711000123",
      senderid: "8809601000000",
      message: "Code 123456",
    });
    // Message id + masked number only: never the OTP text or the key.
    expect(logs).toEqual(["[sms:bulksmsbd] sent id=98765 to=88017*****123"]);
    expect(logs.join()).not.toMatch(/123456|test-key/);
  });

  it("sends Bangla text as percent-encoded UTF-8", async () => {
    const text = "EasyCommerce: দোকান খোলার কোড ৪৫৬৭৮৯। কাউকে জানাবেন না।";
    const { p, calls } = provider(async () => json(ok));
    await p.send({ to: "+8801811000222", text });
    expect(calls[0]).toContain(encodeURIComponent("দোকান").replace(/%20/g, "+"));
    expect(new URL(calls[0]!).searchParams.get("message")).toBe(text);
  });

  it.each([
    [1001, "SMS_INVALID_NUMBER"],
    [1002, "SMS_SENDER_ID"],
    [1007, "SMS_BALANCE"],
    [1018, "SMS_ACCOUNT"],
    [1032, "SMS_IP_NOT_ALLOWED"],
    [1999, "SMS_GATEWAY_ERROR"],
  ] as const)("maps gateway code %i to %s and does not retry", async (code, expected) => {
    const { p, calls } = provider(async () => json({ response_code: code, error_message: "nope" }));
    const error = await p.send({ to: "+8801711000123", text: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsSendError);
    expect(error).toMatchObject({ code: expected, gatewayCode: code });
    expect(calls).toHaveLength(1);
  });

  it("accepts a bare numeric response body", async () => {
    const { p } = provider(async () => new Response("202"));
    await expect(p.send({ to: "+8801711000123", text: "x" })).resolves.toEqual({ messageId: null });
    const { p: p2 } = provider(async () => new Response("<html>oops</html>", { status: 502 }));
    await expect(p2.send({ to: "+8801711000123", text: "x" })).rejects.toMatchObject({
      code: "SMS_BAD_RESPONSE",
    });
  });

  it("times out after the configured limit without retrying", async () => {
    const { p, calls } = provider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
      50,
    );
    await expect(p.send({ to: "+8801711000123", text: "x" })).rejects.toMatchObject({ code: "SMS_TIMEOUT" });
    expect(calls).toHaveLength(1);
  });

  it("uses a 10 s timeout by default", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout");
    const { p } = provider(async (_u, init) => (seen.push(init?.signal), json(ok)));
    await p.send({ to: "+8801711000123", text: "x" });
    expect(spy).toHaveBeenCalledWith(10_000);
    spy.mockRestore();
  });

  it("retries once when the gateway can't be reached, then succeeds", async () => {
    let n = 0;
    const { p, calls } = provider(async () => {
      if (n++ === 0) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return json(ok);
    });
    await expect(p.send({ to: "+8801711000123", text: "x" })).resolves.toEqual({ messageId: "98765" });
    expect(calls).toHaveLength(2);
  });

  it("gives up after one retry, and never retries an ambiguous network failure", async () => {
    const refused = provider(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    await expect(refused.p.send({ to: "+8801711000123", text: "x" })).rejects.toMatchObject({
      code: "SMS_NETWORK",
    });
    expect(refused.calls).toHaveLength(2);
    // A reset after the request was sent may already have delivered the SMS: no retry.
    const reset = provider(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    await expect(reset.p.send({ to: "+8801711000123", text: "x" })).rejects.toMatchObject({
      code: "SMS_NETWORK",
    });
    expect(reset.calls).toHaveLength(1);
  });

  it("refuses non-BD numbers before calling the gateway", async () => {
    const { p, calls } = provider(async () => json(ok));
    await expect(p.send({ to: "+14155550100", text: "x" })).rejects.toMatchObject({
      code: "SMS_INVALID_NUMBER",
    });
    expect(calls).toHaveLength(0);
  });

  it("formats and masks numbers", () => {
    expect(toGatewayNumber("+8801711000123")).toBe("8801711000123");
    expect(toGatewayNumber("01711000123")).toBe("8801711000123");
    expect(maskNumber("8801711000123")).toBe("88017*****123");
  });

  it("reads SMS_API_KEY, SMS_SENDER_ID and SMS_API_URL", () => {
    const p = BulkSmsBdProvider.fromEnv({
      SMS_API_KEY: "k",
      SMS_SENDER_ID: "s",
      SMS_API_URL: "https://sms.example/api",
    });
    expect(p.config).toMatchObject({ apiKey: "k", senderId: "s", apiUrl: "https://sms.example/api" });
    expect(BulkSmsBdProvider.fromEnv({ SMS_API_KEY: "k", SMS_SENDER_ID: "s" }).config.apiUrl).toBe(
      BULKSMSBD_DEFAULT_URL,
    );
    expect(() => BulkSmsBdProvider.fromEnv({ SMS_SENDER_ID: "s" })).toThrow(/SMS_API_KEY/);
  });
});

describe("console SMS in production", () => {
  it("is refused unless ALLOW_CONSOLE_SMS=true, which warns loudly", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMS_PROVIDER", "console");
    vi.stubEnv("ALLOW_CONSOLE_SMS", "");
    expect(() => assertSmsConfig()).toThrow(/refused in production/);
    expect(() => getSmsProvider("console")).toThrow(/refused in production/);

    vi.stubEnv("ALLOW_CONSOLE_SMS", "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertSmsConfig()).not.toThrow();
    expect(getSmsProvider("console")).toBeInstanceOf(ConsoleSmsProvider);
    warn.mockRestore();
  });

  it("is fine in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertSmsConfig({ SMS_PROVIDER: "console" })).not.toThrow();
  });

  it("validates bulksmsbd configuration at startup", () => {
    expect(() => assertSmsConfig({ SMS_PROVIDER: "bulksmsbd" })).toThrow(/SMS_API_KEY/);
    expect(() => assertSmsConfig({ SMS_PROVIDER: "twilio" })).toThrow(/Unknown SMS_PROVIDER/);
  });
});

const live = Boolean(process.env.SMS_API_KEY && process.env.SMS_SENDER_ID && process.env.SMS_TEST_NUMBER);

describe.skipIf(!live)("live BulkSMSBD send (opt-in: SMS_API_KEY + SMS_SENDER_ID + SMS_TEST_NUMBER)", () => {
  it("sends one Bangla test SMS to SMS_TEST_NUMBER", async () => {
    const p = BulkSmsBdProvider.fromEnv();
    const result = await p.send({ to: process.env.SMS_TEST_NUMBER!, text: "EasyCommerce পরীক্ষা / test" });
    expect(result.messageId).not.toBeUndefined();
  });
});
