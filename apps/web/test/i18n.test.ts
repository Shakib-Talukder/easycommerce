import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import bn from "../messages/bn.json";
import en from "../messages/en.json";
import { resolveLocale, surfaceFor } from "../src/i18n/locale";

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

/** {name} / {count, plural, …} argument names used by a message. */
const args = (message: string) => [...message.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("messages", () => {
  it("bn.json and en.json have identical key sets", () => {
    const b = keys(bn as Tree).sort();
    const e = keys(en as Tree).sort();
    expect(
      b.filter((k) => !e.includes(k)),
      "only in bn.json",
    ).toEqual([]);
    expect(
      e.filter((k) => !b.includes(k)),
      "only in en.json",
    ).toEqual([]);
  });

  it("uses the same placeholders in both languages and has no empty messages", () => {
    const lookup = (tree: Tree, key: string) =>
      key.split(".").reduce<string | Tree>((node, part) => (node as Tree)[part]!, tree) as string;
    for (const key of keys(en as Tree)) {
      const [b, e] = [lookup(bn as Tree, key), lookup(en as Tree, key)];
      expect(b.trim(), `bn ${key}`).not.toBe("");
      expect(args(b), key).toEqual(args(e));
    }
  });

  it("has a message for every error code returned by packages/core", () => {
    const root = path.resolve(import.meta.dirname, "../../../packages/core/src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
      });
    const codes = new Set<string>();
    for (const file of files(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/error: "([A-Z_]+)"/g)) codes.add(m[1]!);
      for (const m of src.matchAll(/message: "([A-Z_]+)"/g)) codes.add(m[1]!);
    }
    expect(codes.size).toBeGreaterThan(10);
    const known = Object.keys(en.errors);
    expect([...codes].filter((c) => !known.includes(c))).toEqual([]);
  });
});

describe("locale resolution", () => {
  it("admin: users.locale → ec_locale cookie → bn", () => {
    expect(resolveLocale("admin", { userLocale: "en", cookieLocale: "bn" })).toBe("en");
    expect(resolveLocale("admin", { userLocale: null, cookieLocale: "en" })).toBe("en");
    expect(resolveLocale("admin", { userLocale: undefined, cookieLocale: "fr" })).toBe("bn");
    expect(resolveLocale("admin", {})).toBe("bn");
  });

  it("storefront: the store's language, ignoring the visitor's cookie", () => {
    expect(resolveLocale("storefront", { storeLanguage: "en", cookieLocale: "bn" })).toBe("en");
    expect(resolveLocale("storefront", { storeLanguage: null, cookieLocale: "en" })).toBe("bn");
  });

  it("root domain: cookie → bn, never a user preference", () => {
    expect(resolveLocale("root", { cookieLocale: "en", userLocale: "bn" })).toBe("en");
    expect(resolveLocale("root", { userLocale: "en" })).toBe("bn");
  });

  it("classifies requests into surfaces", () => {
    expect(surfaceFor(false, "/signup")).toBe("root");
    expect(surfaceFor(true, "/admin")).toBe("admin");
    expect(surfaceFor(true, "/admin/settings")).toBe("admin");
    expect(surfaceFor(true, "/administrator")).toBe("storefront");
    expect(surfaceFor(true, "/products/x")).toBe("storefront");
  });
});
