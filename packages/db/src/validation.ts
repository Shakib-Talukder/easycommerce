import { z } from "zod";
import { RESERVED_SUBDOMAINS } from "./host";
import { normalizeDigits } from "./money";

/*
 * Issue messages are error codes (e.g. "INVALID_PHONE"), not prose. Apps map
 * them to translated text (apps/web: messages/*.json → errors.<CODE>).
 */

/** 3–30 chars of [a-z0-9-], no leading/trailing hyphen. Mirrors stores_subdomain_format_chk. */
export const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SUBDOMAIN_PATTERN, "SUBDOMAIN_FORMAT")
  .refine((s) => !RESERVED_SUBDOMAINS.has(s), "SUBDOMAIN_RESERVED");

/**
 * Turns a store name into a subdomain candidate: lowercase a–z0–9 and single
 * hyphens, at most 30 chars. Returns "" when nothing usable is left (e.g. an
 * all-Bangla name).
 */
export function slugifySubdomain(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
}

/** Store name in one language: 1–100 chars. */
export const storeNameSchema = z.string().trim().min(1, "REQUIRED").max(100, "TOO_LONG");

/** #rrggbb, normalised to lowercase. Mirrors store_settings_*_color_chk. */
export const hexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "INVALID_COLOR");

const BD_MOBILE_E164 = /^\+8801[3-9]\d{8}$/;

/**
 * Normalises a Bangladeshi mobile number to E.164 (+8801XXXXXXXXX), or returns
 * null. Accepts 01XXXXXXXXX, 8801XXXXXXXXX and +8801XXXXXXXXX (spaces, dashes
 * and parentheses ignored). Operator prefixes 013–019 only.
 */
export function normalizeBdPhone(input: string): string | null {
  const s = normalizeDigits(input).replace(/[\s\-()]/g, "");
  const e164 = s.startsWith("+") ? s : s.startsWith("880") ? `+${s}` : s.startsWith("0") ? `+88${s}` : s;
  return BD_MOBILE_E164.test(e164) ? e164 : null;
}

export const bdPhoneSchema = z.string().transform((s, ctx) => {
  const phone = normalizeBdPhone(s);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "INVALID_PHONE" });
    return z.NEVER;
  }
  return phone;
});

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("INVALID_EMAIL"));

export type Identifier = { kind: "email" | "phone"; value: string };

/** Login identifier: an email address or a BD mobile number, normalised. */
export const identifierSchema = z
  .string()
  .trim()
  .min(1, "REQUIRED")
  .transform((s, ctx): Identifier => {
    if (s.includes("@")) {
      const email = emailSchema.safeParse(s);
      if (email.success) return { kind: "email", value: email.data };
    } else {
      const phone = normalizeBdPhone(s);
      if (phone) return { kind: "phone", value: phone };
    }
    ctx.addIssue({ code: "custom", message: "INVALID_IDENTIFIER" });
    return z.NEVER;
  });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens")
  .max(120);

/** Non-negative integer poisha. */
export const poishaSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const userInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema.optional(),
    phone: bdPhoneSchema.optional(),
    role: z.enum(["OWNER", "STAFF"]).default("STAFF"),
  })
  .refine((u) => u.email !== undefined || u.phone !== undefined, {
    message: "Provide an email or a phone number",
    path: ["email"],
  });

export const storeInputSchema = z.object({
  nameBn: storeNameSchema,
  nameEn: storeNameSchema,
  subdomain: subdomainSchema,
});

export const variantInputSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  options: z.record(z.string(), z.string()).default({}),
  price: poishaSchema,
  compareAtPrice: poishaSchema.optional(),
  stock: z.number().int().nonnegative().default(0),
  weightGrams: z.number().int().nonnegative().optional(),
});

export const productInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(20_000).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  categoryId: z.string().optional(),
  images: z.array(z.object({ url: z.url(), alt: z.string().optional() })).default([]),
  basePrice: poishaSchema,
  compareAtPrice: poishaSchema.optional(),
  variants: z.array(variantInputSchema).default([]),
});

export type UserInput = z.infer<typeof userInputSchema>;
export type StoreInput = z.infer<typeof storeInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;
