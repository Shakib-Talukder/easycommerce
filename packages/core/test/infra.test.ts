import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateOtp, hashOtp, safeEqualHex, verifyOtpHash } from "../src/auth/crypto";
import { needsRefresh, signSessionToken, verifySessionToken } from "../src/auth/jwt";
import { can } from "../src/auth/rbac";
import {
  MemoryKeyValueStore,
  RedisKeyValueStore,
  connectRedis,
  getKeyValueStore,
  setKeyValueStore,
} from "../src/kv";
import { BulkSmsBdProvider, ConsoleSmsProvider, getSmsProvider } from "../src/notify";
import { KvRateLimiter, checkOtpSendLimits } from "../src/rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
  setKeyValueStore(undefined);
});

describe("MemoryKeyValueStore setIfAbsent/ttl", () => {
  it("stores only when absent and reports the remaining TTL", async () => {
    let now = 0;
    const kv = new MemoryKeyValueStore({ now: () => now });
    expect(await kv.setIfAbsent("k", "1", 60)).toBe(true);
    expect(await kv.setIfAbsent("k", "2", 60)).toBe(false);
    now = 20_500;
    expect(await kv.ttl("k")).toBe(40);
    now = 60_000;
    expect(await kv.ttl("k")).toBe(0);
    expect(await kv.setIfAbsent("k", "3", 60)).toBe(true);
  });
});

describe("MemoryKeyValueStore", () => {
  it("expires keys, takes once, and keeps the TTL of the first incr", async () => {
    let now = 1_000_000;
    const kv = new MemoryKeyValueStore({ now: () => now });
    await kv.set("a", "1", 10);
    expect(await kv.get("a")).toBe("1");
    now += 10_000;
    expect(await kv.get("a")).toBeNull();

    await kv.set("b", "x", 60);
    expect(await kv.take("b")).toBe("x");
    expect(await kv.take("b")).toBeNull();
    expect(await kv.del("b")).toBe(false);

    expect(await kv.incr("c", 5)).toBe(1);
    now += 4_000;
    expect(await kv.incr("c", 5)).toBe(2); // window not extended
    now += 1_000;
    expect(await kv.incr("c", 5)).toBe(1);
  });
});

describe("rate limiter (memory)", () => {
  it("allows max hits per window, then blocks until the window resets", async () => {
    let now = 0;
    const limiter = new KvRateLimiter(new MemoryKeyValueStore({ now: () => now }));
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await limiter.limit("k", 3, 900));
    expect(hits.map((h) => h.ok)).toEqual([true, true, true, false]);
    expect(hits[2]?.remaining).toBe(0);
    now += 900_000;
    expect((await limiter.limit("k", 3, 900)).ok).toBe(true);
  });

  it("applies 3/identifier/15min and 10/IP/hour for OTP sends", async () => {
    const limiter = new KvRateLimiter(new MemoryKeyValueStore());
    const sends = [];
    for (let i = 0; i < 4; i++)
      sends.push(await checkOtpSendLimits(limiter, "s1", "+8801711000000", "1.1.1.1"));
    expect(sends).toEqual([true, true, true, false]);

    // Different identifiers from one IP: 4 used above, 6 more allowed, then blocked.
    const fromIp = [];
    for (let i = 0; i < 7; i++)
      fromIp.push(await checkOtpSendLimits(limiter, "s1", `+88017110000${10 + i}`, "1.1.1.1"));
    expect(fromIp).toEqual([true, true, true, true, true, true, false]);
  });
});

describe("getKeyValueStore", () => {
  it("falls back to memory in development and warns once", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1"); // nothing listens on port 1
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kv = await getKeyValueStore();
    expect(kv.kind).toBe("memory");
    setKeyValueStore(undefined);
    await getKeyValueStore();
    expect(warn.mock.calls.filter(([m]) => String(m).includes("[kv]"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("refuses the memory fallback in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
    await expect(getKeyValueStore()).rejects.toThrow(/refusing to run in production/);
    vi.stubEnv("REDIS_URL", "");
    await expect(getKeyValueStore()).rejects.toThrow(/REDIS_URL is required/);
  });
});

// A real Redis (default: DB 15 on 127.0.0.1:6379, override with REDIS_TEST_URL). Skipped when unreachable.
const redisTestUrl = process.env.REDIS_TEST_URL || "redis://127.0.0.1:6379/15";
const redisReachable = await connectRedis(redisTestUrl, 1000)
  .then(async (r) => (await r.quit(), true))
  .catch(() => false);

describe.skipIf(!redisReachable)(`RedisKeyValueStore against a real Redis (${redisTestUrl})`, () => {
  const p = `test:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
  let kv: RedisKeyValueStore;

  beforeAll(async () => {
    kv = new RedisKeyValueStore(await connectRedis(redisTestUrl));
  });

  afterAll(async () => {
    for (const k of ["a", "c", "n"]) await kv?.del(p + k);
    await kv?.quit();
  });

  it("implements the KeyValueStore contract", async () => {
    await kv.set(p + "a", "1", 60);
    expect(await kv.get(p + "a")).toBe("1");
    expect(await kv.ttl(p + "a")).toBeGreaterThan(55);
    expect(await kv.take(p + "a")).toBe("1");
    expect(await kv.take(p + "a")).toBeNull();
    expect(await kv.ttl(p + "a")).toBe(0);
    expect(await kv.incr(p + "c", 60)).toBe(1);
    expect(await kv.incr(p + "c", 60)).toBe(2);
    expect(await kv.del(p + "c")).toBe(true);
    expect(await kv.del(p + "c")).toBe(false);
    expect(await kv.setIfAbsent(p + "n", "x", 60)).toBe(true);
    expect(await kv.setIfAbsent(p + "n", "y", 60)).toBe(false);
    expect(await kv.get(p + "n")).toBe("x");
  });
});

describe("OTP crypto", () => {
  it("generates 6-digit codes", () => {
    const codes = Array.from({ length: 200 }, generateOtp);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(190);
  });

  it("binds hashes to scope and identifier and compares in constant time", () => {
    const h = hashOtp("store1", "+8801711000000", "123456");
    expect(verifyOtpHash("store1", "+8801711000000", "123456", h)).toBe(true);
    expect(verifyOtpHash("store2", "+8801711000000", "123456", h)).toBe(false);
    expect(verifyOtpHash("store1", "+8801711000001", "123456", h)).toBe(false);
    expect(verifyOtpHash("store1", "+8801711000000", "12345a", h)).toBe(false);
    expect(safeEqualHex("ab", "abcd")).toBe(false);
  });
});

describe("session JWT", () => {
  const claims = { sub: "u1", storeId: "s1", role: "OWNER" as const, sid: "sess1" };

  it("round-trips and rejects tampering, expiry and other secrets", async () => {
    const { token } = await signSessionToken(claims);
    expect(await verifySessionToken(token)).toMatchObject(claims);

    const [h, p, s] = token.split(".");
    const forged = JSON.parse(Buffer.from(p!, "base64url").toString());
    forged.storeId = "s2";
    expect(
      await verifySessionToken(`${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`),
    ).toBeNull();

    const old = await signSessionToken(claims, Math.floor(Date.now() / 1000) - 31 * 24 * 3600);
    expect(await verifySessionToken(old.token)).toBeNull();

    vi.stubEnv("JWT_SECRET", "a-completely-different-secret-of-sufficient-length");
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("asks for a refresh only in the last 7 days", () => {
    const now = 1_000_000;
    expect(needsRefresh(now + 8 * 86400, now)).toBe(false);
    expect(needsRefresh(now + 6 * 86400, now)).toBe(true);
  });
});

describe("RBAC", () => {
  it("gives STAFF no settings or staff management", () => {
    expect(can("OWNER", "settings:manage")).toBe(true);
    expect(can("STAFF", "settings:manage")).toBe(false);
    expect(can("STAFF", "staff:manage")).toBe(false);
    expect(can("STAFF", "dashboard:view")).toBe(true);
  });
});

describe("SMS providers", () => {
  it("selects by SMS_PROVIDER", () => {
    expect(getSmsProvider("console")).toBeInstanceOf(ConsoleSmsProvider);
    expect(() => getSmsProvider("bulksmsbd")).toThrow(/SMS_API_KEY/);
    vi.stubEnv("SMS_API_KEY", "k");
    vi.stubEnv("SMS_SENDER_ID", "8809601000000");
    expect(getSmsProvider("bulksmsbd")).toBeInstanceOf(BulkSmsBdProvider);
    expect(() => getSmsProvider("twilio")).toThrow(/Unknown SMS_PROVIDER/);
  });
});
