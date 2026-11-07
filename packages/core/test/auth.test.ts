import { createId } from "@paralleldrive/cuid2";
import { disconnectAll } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import type { Identifier } from "@repo/db/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consumeHandoff, createHandoff } from "../src/auth/handoff";
import { signSessionToken } from "../src/auth/jwt";
import { requestLoginCode, verifyLoginCode, type StoreContext } from "../src/auth/otp";
import { createSession, refreshSession, revokeSession, validateSession } from "../src/auth/sessions";
import { completeSignup, startSignup } from "../src/auth/signup";
import { deactivateStaff, inviteStaff } from "../src/auth/staff";
import { MemoryKeyValueStore, setKeyValueStore } from "../src/kv";
import { captureCodes, createTestStore, deleteStores, testPhone } from "./helpers";

const created: string[] = [];
let storeA: StoreContext;
let storeB: StoreContext;
let ownerA: { id: string; phone: string };
let codes: ReturnType<typeof captureCodes>;
let ip = 0;
const nextIp = () => `10.0.${Math.floor(++ip / 250)}.${ip % 250}`;
const phoneId = (value: string): Identifier => ({ kind: "phone", value });

beforeAll(async () => {
  const a = await createTestStore("auth-a");
  const b = await createTestStore("auth-b");
  created.push(a.id, b.id);
  storeA = { id: a.id, name: a.name, language: "en" };
  storeB = { id: b.id, name: b.name, language: "en" };
  const phone = testPhone();
  const user = await adminClient().user.create({
    data: { storeId: a.id, name: "Owner A", phone, role: "OWNER" },
  });
  ownerA = { id: user.id, phone };
});

beforeEach(() => {
  // Fresh rate-limit and signup state per test.
  setKeyValueStore(new MemoryKeyValueStore());
  codes?.restore();
  codes = captureCodes();
});

afterAll(async () => {
  codes?.restore();
  await deleteStores(...created);
  await disconnectAll();
});

describe("login OTP", () => {
  it("sends a code, verifies it once, and never again", async () => {
    expect(
      await requestLoginCode({ store: storeA, identifier: phoneId(ownerA.phone), ip: nextIp() }),
    ).toEqual({ ok: true });
    const code = codes.last(ownerA.phone);

    const ok = await verifyLoginCode({ storeId: storeA.id, identifier: phoneId(ownerA.phone), code });
    expect(ok).toMatchObject({ ok: true, user: { id: ownerA.id, role: "OWNER" } });

    const again = await verifyLoginCode({ storeId: storeA.id, identifier: phoneId(ownerA.phone), code });
    expect(again).toEqual({ ok: false, error: "INVALID_CODE" });
  });

  it("stores only a hash of the code", async () => {
    await requestLoginCode({ store: storeA, identifier: phoneId(ownerA.phone), ip: nextIp() });
    const code = codes.last(ownerA.phone);
    const row = await adminClient().otpCode.findFirst({
      where: { storeId: storeA.id, identifier: ownerA.phone },
      orderBy: { createdAt: "desc" },
    });
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.codeHash).not.toContain(code);
  });

  it("answers identically for unknown users and sends nothing", async () => {
    const stranger = testPhone();
    expect(await requestLoginCode({ store: storeA, identifier: phoneId(stranger), ip: nextIp() })).toEqual({
      ok: true,
    });
    expect(codes.messages.find((m) => m.to === stranger)).toBeUndefined();
    expect(
      await verifyLoginCode({ storeId: storeA.id, identifier: phoneId(stranger), code: "123456" }),
    ).toEqual({
      ok: false,
      error: "INVALID_CODE",
    });
  });

  it("locks the code after 5 attempts, even for the right code", async () => {
    await requestLoginCode({ store: storeA, identifier: phoneId(ownerA.phone), ip: nextIp() });
    const code = codes.last(ownerA.phone);
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        (await verifyLoginCode({ storeId: storeA.id, identifier: phoneId(ownerA.phone), code: wrong })).ok,
      );
    }
    expect(results).toEqual([false, false, false, false, false]);
    expect(await verifyLoginCode({ storeId: storeA.id, identifier: phoneId(ownerA.phone), code })).toEqual({
      ok: false,
      error: "TOO_MANY_ATTEMPTS",
    });
  });

  it("rejects an expired code", async () => {
    await requestLoginCode({ store: storeA, identifier: phoneId(ownerA.phone), ip: nextIp() });
    const code = codes.last(ownerA.phone);
    await adminClient().otpCode.updateMany({
      where: { storeId: storeA.id, identifier: ownerA.phone, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await verifyLoginCode({ storeId: storeA.id, identifier: phoneId(ownerA.phone), code })).toEqual({
      ok: false,
      error: "INVALID_CODE",
    });
  });

  it("a code for store A does not work in store B", async () => {
    await requestLoginCode({ store: storeA, identifier: phoneId(ownerA.phone), ip: nextIp() });
    const code = codes.last(ownerA.phone);
    expect((await verifyLoginCode({ storeId: storeB.id, identifier: phoneId(ownerA.phone), code })).ok).toBe(
      false,
    );
  });

  it("rate-limits the 4th send to one identifier within 15 minutes", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await requestLoginCode({ store: storeA, identifier: phoneId(ownerA.phone), ip: nextIp() }),
      );
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ ok: false, error: "RATE_LIMITED" });
  });
});

describe("sessions", () => {
  it("validates on its own store and rejects the same JWT on another store", async () => {
    const { token } = await createSession(storeA.id, { id: ownerA.id, role: "OWNER" });
    expect((await validateSession(token, storeA.id))?.user.id).toBe(ownerA.id);
    expect(await validateSession(token, storeB.id)).toBeNull();
  });

  it("rejects a revoked session", async () => {
    const s = await createSession(storeA.id, { id: ownerA.id, role: "OWNER" });
    await revokeSession(storeA.id, s.sessionId);
    expect(await validateSession(s.token, storeA.id)).toBeNull();
  });

  it("rejects a JWT whose sessions row is missing", async () => {
    const { token } = await signSessionToken({
      sub: ownerA.id,
      storeId: storeA.id,
      role: "OWNER",
      sid: createId(),
    });
    expect(await validateSession(token, storeA.id)).toBeNull();
  });

  it("refreshes only when fewer than 7 days remain", async () => {
    const s = await createSession(storeA.id, { id: ownerA.id, role: "OWNER" });
    expect(await refreshSession(s.token, storeA.id)).toBeNull();

    const aging = await signSessionToken(
      { sub: ownerA.id, storeId: storeA.id, role: "OWNER", sid: s.sessionId },
      Math.floor(Date.now() / 1000) - 24 * 86400,
    );
    const refreshed = await refreshSession(aging.token, storeA.id);
    expect(refreshed?.sessionId).toBe(s.sessionId);
    expect(refreshed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
    expect(await validateSession(refreshed!.token, storeA.id)).not.toBeNull();
    expect(await refreshSession(aging.token, storeB.id)).toBeNull();
  });
});

describe("store signup", () => {
  const signup = async (subdomain: string, phone: string) => {
    const started = await startSignup({
      storeName: "দোকান",
      subdomain,
      identifier: phoneId(phone),
      ip: nextIp(),
    });
    expect(started).toEqual({ ok: true });
    return codes.last(phone);
  };

  it("creates store, settings and OWNER in one RLS-scoped transaction", async () => {
    const subdomain = `t-signup-${createId().slice(0, 6)}`;
    const phone = testPhone();
    const code = await signup(subdomain, phone);

    const result = await completeSignup({ subdomain, identifier: phoneId(phone), code });
    if (!result.ok) throw new Error(result.error);
    created.push(result.store.id);

    const store = await adminClient().store.findUnique({
      where: { id: result.store.id },
      include: { settings: true, users: true },
    });
    expect(store).toMatchObject({ subdomain, status: "ACTIVE", name: "দোকান" });
    expect(store?.settings?.storeId).toBe(result.store.id);
    expect(store?.users).toEqual([expect.objectContaining({ phone, role: "OWNER", isActive: true })]);

    // Single use.
    expect(await completeSignup({ subdomain, identifier: phoneId(phone), code })).toEqual({
      ok: false,
      error: "INVALID_CODE",
    });
    // Now taken for everyone else.
    expect(
      await startSignup({ storeName: "x", subdomain, identifier: phoneId(testPhone()), ip: nextIp() }),
    ).toEqual({
      ok: false,
      error: "SUBDOMAIN_TAKEN",
    });
  });

  it("lets exactly one of two concurrent signups claim a subdomain", async () => {
    const subdomain = `t-race-${createId().slice(0, 6)}`;
    const [p1, p2] = [testPhone(), testPhone()];
    const [c1, c2] = [await signup(subdomain, p1), await signup(subdomain, p2)];

    const results = await Promise.all([
      completeSignup({ subdomain, identifier: phoneId(p1), code: c1 }),
      completeSignup({ subdomain, identifier: phoneId(p2), code: c2 }),
    ]);
    for (const r of results) if (r.ok) created.push(r.store.id);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "SUBDOMAIN_TAKEN" }]);
  });

  it("limits signup verification to 5 attempts", async () => {
    const subdomain = `t-att-${createId().slice(0, 6)}`;
    const phone = testPhone();
    const code = await signup(subdomain, phone);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await completeSignup({ subdomain, identifier: phoneId(phone), code: wrong });
    expect(await completeSignup({ subdomain, identifier: phoneId(phone), code })).toMatchObject({
      ok: false,
    });
    expect(await adminClient().store.findUnique({ where: { subdomain } })).toBeNull();
  });

  it("hands off exactly once", async () => {
    const token = await createHandoff({ storeId: storeA.id, userId: ownerA.id });
    expect(await consumeHandoff(token)).toEqual({ storeId: storeA.id, userId: ownerA.id });
    expect(await consumeHandoff(token)).toBeNull();
  });
});

describe("staff", () => {
  it("invites inactive staff who activate by logging in with the invite code", async () => {
    const phone = testPhone();
    const invited = await inviteStaff({ store: storeA, name: "Staff", identifier: phoneId(phone) });
    if (!invited.ok) throw new Error(invited.error);
    const user = await adminClient().user.findUnique({ where: { id: invited.userId } });
    expect(user).toMatchObject({ role: "STAFF", isActive: false });

    // An inactive user can't request a normal login code.
    await requestLoginCode({ store: storeA, identifier: phoneId(phone), ip: nextIp() });
    const inviteCode = codes.messages.filter((m) => m.to === phone);
    expect(inviteCode).toHaveLength(1);

    const login = await verifyLoginCode({
      storeId: storeA.id,
      identifier: phoneId(phone),
      code: inviteCode[0]!.code,
    });
    expect(login).toMatchObject({ ok: true, user: { role: "STAFF" } });
    expect((await adminClient().user.findUnique({ where: { id: invited.userId } }))?.isActive).toBe(true);

    expect(await inviteStaff({ store: storeA, name: "Again", identifier: phoneId(phone) })).toEqual({
      ok: false,
      error: "ALREADY_MEMBER",
    });
  });

  it("deactivating staff revokes their sessions; owners can't be deactivated", async () => {
    const phone = testPhone();
    const staff = await adminClient().user.create({
      data: { storeId: storeA.id, name: "S", phone, role: "STAFF" },
    });
    const s = await createSession(storeA.id, { id: staff.id, role: "STAFF" });
    expect(await validateSession(s.token, storeA.id)).not.toBeNull();

    expect(await deactivateStaff({ storeId: storeA.id, actorUserId: ownerA.id, userId: staff.id })).toEqual({
      ok: true,
    });
    expect(await validateSession(s.token, storeA.id)).toBeNull();
    expect(await deactivateStaff({ storeId: storeA.id, actorUserId: staff.id, userId: ownerA.id })).toEqual({
      ok: false,
      error: "CANNOT_DEACTIVATE",
    });
  });
});
