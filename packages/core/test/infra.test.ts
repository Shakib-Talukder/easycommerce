import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
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

describe("RedisKeyValueStore against scripts/local-redis.ts", () => {
  const port = 6390 + Math.floor(Math.random() * 100);
  let server: ChildProcess;
  let kv: RedisKeyValueStore;

  beforeAll(async () => {
    const tsx = path.resolve(import.meta.dirname, "../node_modules/tsx/dist/cli.mjs");
    server = spawn(process.execPath, [tsx, path.resolve(import.meta.dirname, "../scripts/local-redis.ts")], {
      env: { ...process.env, REDIS_PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve, reject) => {
      server.stdout?.on("data", (d: Buffer) => d.toString().includes("ready") && resolve());
      server.on("exit", (code) => reject(new Error(`local-redis exited with ${code}`)));
    });
    kv = new RedisKeyValueStore(await connectRedis(`redis://127.0.0.1:${port}`));
  });

  afterAll(async () => {
    await kv?.quit();
    server?.kill();
  });

  it("implements the KeyValueStore contract", async () => {
    await kv.set("r:a", "1", 60);
    expect(await kv.get("r:a")).toBe("1");
    expect(await kv.take("r:a")).toBe("1");
    expect(await kv.take("r:a")).toBeNull();
    expect(await kv.incr("r:c", 60)).toBe(1);
    expect(await kv.incr("r:c", 60)).toBe(2);
    expect(await kv.del("r:c")).toBe(true);
    expect(await kv.del("r:c")).toBe(false);
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
