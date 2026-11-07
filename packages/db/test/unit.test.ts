import { describe, expect, it } from "vitest";
import { parseHost } from "../src/host";
import { formatBDT, poishaToTakaString, takaToPoisha } from "../src/money";
import { bdPhoneSchema, subdomainSchema, userInputSchema } from "../src/validation";

describe("money", () => {
  it("parses taka strings to integer poisha without float error", () => {
    expect(takaToPoisha("1250")).toBe(125000);
    expect(takaToPoisha("1,250.5")).toBe(125050);
    expect(takaToPoisha("0.29")).toBe(29);
    expect(takaToPoisha(19.99)).toBe(1999);
    expect(() => takaToPoisha("1.999")).toThrow();
    expect(() => takaToPoisha("-5")).toThrow();
  });

  it("formats poisha", () => {
    expect(poishaToTakaString(125050)).toBe("1250.50");
    expect(poishaToTakaString(5)).toBe("0.05");
    expect(formatBDT(125050, "en")).toContain("1,250.50");
    expect(formatBDT(125050, "bn")).toContain("১,২৫০.৫০");
    expect(() => formatBDT(1.5)).toThrow();
  });
});

describe("parseHost", () => {
  it("handles a production root domain", () => {
    expect(parseHost("example.com", "example.com")).toEqual({ kind: "root" });
    expect(parseHost("www.example.com", "example.com")).toEqual({ kind: "root" });
    expect(parseHost("Shop.Example.com:443", "example.com")).toEqual({
      kind: "subdomain",
      subdomain: "shop",
    });
    expect(parseHost("admin.example.com", "example.com")).toEqual({ kind: "root" });
    expect(parseHost("a.b.example.com", "example.com")).toEqual({ kind: "root" });
    expect(parseHost("myshop.com.bd", "example.com")).toEqual({ kind: "custom", domain: "myshop.com.bd" });
  });

  it("handles localhost with a port", () => {
    expect(parseHost("localhost:3000", "localhost:3000")).toEqual({ kind: "root" });
    expect(parseHost("dhaka-fashion.localhost:3000", "localhost:3000")).toEqual({
      kind: "subdomain",
      subdomain: "dhaka-fashion",
    });
  });
});

describe("validation", () => {
  it("normalises Bangladeshi phones to E.164", () => {
    expect(bdPhoneSchema.parse("01711-000000")).toBe("+8801711000000");
    expect(bdPhoneSchema.parse("8801711000000")).toBe("+8801711000000");
    expect(bdPhoneSchema.parse("+8801711000000")).toBe("+8801711000000");
    expect(bdPhoneSchema.safeParse("01211000000").success).toBe(false);
    expect(bdPhoneSchema.safeParse("0171100000").success).toBe(false);
  });

  it("validates subdomains", () => {
    expect(subdomainSchema.parse("Dhaka-Fashion")).toBe("dhaka-fashion");
    for (const bad of ["ab", "-shop", "shop-", "shop_bd", "a".repeat(31), "admin"]) {
      expect(subdomainSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("requires email or phone on users", () => {
    expect(userInputSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(userInputSchema.safeParse({ name: "X", phone: "01811000000" }).success).toBe(true);
    expect(userInputSchema.safeParse({ name: "X", email: "x@y.bd" }).success).toBe(true);
  });
});
