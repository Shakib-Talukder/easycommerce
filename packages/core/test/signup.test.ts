import { createId } from "@paralleldrive/cuid2";
import { disconnectAll } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  STORES_PER_PHONE,
  checkSubdomain,
  checkSubdomainRateLimit,
  createStoreFromTicket,
  readSignupTicket,
  startPhoneSignup,
  verifyPhoneSignup,
} from "../src/auth/signup";
import { MemoryKeyValueStore, setKeyValueStore } from "../src/kv";
import { KvRateLimiter } from "../src/rate-limit";
import { captureCodes, createTestStore, deleteStores, testPhone } from "./helpers";

const created: string[] = [];
let codes: ReturnType<typeof captureCodes>;
let ip = 0;
const nextIp = () => `10.1.${Math.floor(++ip / 250)}.${ip % 250}`;
const freshLimiter = () => new KvRateLimiter(new MemoryKeyValueStore());
const sub = (label: string) => `t-${label}-${createId().slice(0, 6)}`;

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  codes?.restore();
  codes = captureCodes();
});

afterAll(async () => {
  codes?.restore();
  await deleteStores(...created);
  await disconnectAll();
});

/** Phone → OTP → ticket. Uses its own limiter so tests don't share rate-limit buckets. */
async function ticketFor(phone: string): Promise<string> {
  expect(await startPhoneSignup({ phone, ip: nextIp(), limiter: freshLimiter() })).toEqual({ ok: true });
  const verified = await verifyPhoneSignup({ phone, code: codes.last(phone) });
  if (!verified.ok) throw new Error(verified.error);
  return verified.ticket;
}

async function create(ticket: string, subdomain: string) {
  const result = await createStoreFromTicket({
    ticket,
    nameBn: "নতুন দোকান",
    nameEn: "Notun Dokan",
    subdomain,
  });
  if (result.ok) created.push(result.store.id);
  return result;
}

describe("phone-first signup", () => {
  it("creates a PENDING store, settings at step 0 and a bn OWNER from a ticket, once", async () => {
    const phone = testPhone();
    const ticket = await ticketFor(phone);
    expect(await readSignupTicket(ticket)).toMatchObject({ phone });

    const subdomain = sub("new");
    const result = await create(ticket, subdomain);
    if (!result.ok) throw new Error(result.error);

    const store = await adminClient().store.findUnique({
      where: { id: result.store.id },
      include: { settings: true, users: true },
    });
    expect(store).toMatchObject({
      subdomain,
      status: "PENDING",
      nameBn: "নতুন দোকান",
      nameEn: "Notun Dokan",
    });
    expect(store?.settings).toMatchObject({
      onboardingStep: 0,
      onboardingCompletedAt: null,
      contactPhone: phone,
    });
    expect(store?.users).toEqual([
      expect.objectContaining({ phone, role: "OWNER", locale: "bn", isActive: true }),
    ]);

    // The ticket is single use.
    expect(await readSignupTicket(ticket)).toBeNull();
    expect(await create(ticket, sub("again"))).toEqual({ ok: false, error: "TICKET_INVALID" });
  });

  it("requires a ticket", async () => {
    expect(await create("not-a-real-ticket-but-long-enough", sub("x"))).toEqual({
      ok: false,
      error: "TICKET_INVALID",
    });
    expect(await create("short", sub("x"))).toEqual({ ok: false, error: "TICKET_INVALID" });
    expect(await readSignupTicket(undefined)).toBeNull();
  });

  it("rejects an expired ticket", async () => {
    let now = Date.now();
    const kv = new MemoryKeyValueStore({ now: () => now });
    setKeyValueStore(kv);
    const ticket = await ticketFor(testPhone());
    now += 31 * 60 * 1000;
    expect(await readSignupTicket(ticket)).toBeNull();
    expect(await create(ticket, sub("exp"))).toEqual({ ok: false, error: "TICKET_INVALID" });
  });

  it("OTP codes are single use and lock after 5 wrong attempts", async () => {
    const phone = testPhone();
    await startPhoneSignup({ phone, ip: nextIp(), limiter: freshLimiter() });
    const code = codes.last(phone);
    expect((await verifyPhoneSignup({ phone, code })).ok).toBe(true);
    expect(await verifyPhoneSignup({ phone, code })).toEqual({ ok: false, error: "INVALID_CODE" });

    const other = testPhone();
    await startPhoneSignup({ phone: other, ip: nextIp(), limiter: freshLimiter() });
    const right = codes.last(other);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await verifyPhoneSignup({ phone: other, code: wrong });
    expect(await verifyPhoneSignup({ phone: other, code: right })).toEqual({
      ok: false,
      error: "TOO_MANY_ATTEMPTS",
    });
  });

  it("rate-limits the 4th code to one phone within 15 minutes, and 10 per IP per hour", async () => {
    const limiter = freshLimiter();
    const phone = testPhone();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await startPhoneSignup({ phone, ip: nextIp(), limiter }));
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: false, error: "RATE_LIMITED" }]);

    const sameIp = [];
    for (let i = 0; i < 11; i++)
      sameIp.push((await startPhoneSignup({ phone: testPhone(), ip: "9.9.9.9", limiter })).ok);
    expect(sameIp.filter(Boolean)).toHaveLength(10);
    expect(sameIp[10]).toBe(false);
  });

  it(`allows at most ${STORES_PER_PHONE.max} new stores per phone per 24 h`, async () => {
    const phone = testPhone();
    for (let i = 0; i < 3; i++) expect((await create(await ticketFor(phone), sub(`lim${i}`))).ok).toBe(true);

    // The 4th is refused both when asking for a code and when creating.
    expect(await startPhoneSignup({ phone, ip: nextIp(), limiter: freshLimiter() })).toEqual({
      ok: false,
      error: "STORE_LIMIT",
    });
    const owners = await adminClient().user.findMany({ where: { phone, role: "OWNER" } });
    expect(owners).toHaveLength(3);
  });

  it("enforces the store limit exactly under concurrent creates", async () => {
    const phone = testPhone();
    for (let i = 0; i < 2; i++) await create(await ticketFor(phone), sub(`cc${i}`));
    const [t1, t2] = [await ticketFor(phone), await ticketFor(phone)];
    const results = await Promise.all([create(t1, sub("cc-a")), create(t2, sub("cc-b"))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "STORE_LIMIT" }]);
  });

  it("lets exactly one of two concurrent signups claim a subdomain; the loser keeps the ticket", async () => {
    const subdomain = sub("race");
    const [t1, t2] = [await ticketFor(testPhone()), await ticketFor(testPhone())];
    const results = await Promise.all([create(t1, subdomain), create(t2, subdomain)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const loser = results.find((r) => !r.ok);
    expect(loser).toMatchObject({ ok: false, error: "SUBDOMAIN_TAKEN" });
    const suggestions = loser && !loser.ok && "suggestions" in loser ? loser.suggestions : [];
    expect(suggestions).toHaveLength(3);

    // The loser can retry with a suggestion using the same ticket.
    const loserTicket = results[0]!.ok ? t2 : t1;
    expect((await create(loserTicket, suggestions[0]!)).ok).toBe(true);
  });
});

describe("subdomain check", () => {
  it("reports FORMAT, RESERVED and TAKEN with three free, valid suggestions", async () => {
    const taken = await createTestStore("taken");
    created.push(taken.id);

    const format = await checkSubdomain("Not Valid!");
    expect(format).toMatchObject({ available: false, reason: "FORMAT" });
    expect(await checkSubdomain("ab")).toMatchObject({ reason: "FORMAT" });
    expect(await checkSubdomain("admin")).toMatchObject({ available: false, reason: "RESERVED" });

    const t = await checkSubdomain(taken.subdomain);
    expect(t).toMatchObject({ available: false, reason: "TAKEN" });
    for (const check of [format, t]) {
      expect(check.suggestions).toHaveLength(3);
      for (const s of check.suggestions) {
        expect(s).toMatch(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);
        expect(await adminClient().store.findUnique({ where: { subdomain: s } })).toBeNull();
      }
    }
    expect(await checkSubdomain(sub("free"))).toEqual({ available: true, reason: null, suggestions: [] });
  });

  it("skips suggestions that are already taken", async () => {
    const base = sub("sg");
    const store = await adminClient().store.create({
      data: { nameBn: "x", nameEn: "x", subdomain: `${base}-bd` },
    });
    created.push(store.id);
    // Upper case + "!" is a FORMAT error whose slug is `base`.
    const { suggestions } = await checkSubdomain(`${base.toUpperCase()}!`);
    expect(suggestions).not.toContain(`${base}-bd`);
  });

  it("rate-limits to 60 checks per IP per minute", async () => {
    const limiter = freshLimiter();
    const results = [];
    for (let i = 0; i < 61; i++) results.push(await checkSubdomainRateLimit("8.8.8.8", limiter));
    expect(results.slice(0, 60).every(Boolean)).toBe(true);
    expect(results[60]).toBe(false);
    expect(await checkSubdomainRateLimit("8.8.4.4", limiter)).toBe(true);
  });
});
