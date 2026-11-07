import { createId } from "@paralleldrive/cuid2";
import { adminClient } from "@repo/db/admin";
import { vi } from "vitest";

/** Collects OTPs written by the console SMS/email providers. */
export function captureCodes() {
  const messages: { to: string; code: string; text: string }[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    const text = String(line);
    const to = /to=(\S+)/.exec(text)?.[1];
    const code = /\b(\d{6})\b/.exec(text)?.[1];
    if (to && code) messages.push({ to, code, text });
  });
  return {
    messages,
    last(to: string): string {
      const found = [...messages].reverse().find((m) => m.to === to);
      if (!found) throw new Error(`No code was sent to ${to}`);
      return found.code;
    },
    restore: () => spy.mockRestore(),
  };
}

export async function createTestStore(label: string) {
  return adminClient().store.create({
    data: {
      name: `Test ${label}`,
      subdomain: `t-${label}-${createId().slice(0, 8)}`,
      status: "ACTIVE",
      settings: { create: { language: "en" } },
    },
  });
}

export async function deleteStores(...ids: string[]) {
  await adminClient().store.deleteMany({ where: { id: { in: ids } } });
}

/** Unique, valid BD mobile number for a test run. */
let phoneCounter = Math.floor(Math.random() * 1_000_000);
export function testPhone(): string {
  phoneCounter = (phoneCounter + 1) % 100_000_000;
  return `+88017${String(phoneCounter).padStart(8, "0")}`;
}
