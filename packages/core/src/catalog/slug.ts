/**
 * Slugs for categories and products (no dependencies, safe for client components).
 * From the English name when there is one; otherwise a small Bangla → Latin
 * transliteration; otherwise a short random id.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** Lowercase a–z0–9 with single hyphens, at most SLUG_MAX chars. "" when nothing usable is left. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining accents left by NFKD
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

// Bangla script → Latin, close to how Bangladeshis write names in English.
const VOWELS: Record<string, string> = {
  অ: "o",
  আ: "a",
  ই: "i",
  ঈ: "i",
  উ: "u",
  ঊ: "u",
  ঋ: "ri",
  এ: "e",
  ঐ: "oi",
  ও: "o",
  ঔ: "ou",
};
const SIGNS: Record<string, string> = {
  "া": "a",
  "ি": "i",
  "ী": "i",
  "ু": "u",
  "ূ": "u",
  "ৃ": "ri",
  "ে": "e",
  "ৈ": "oi",
  "ো": "o",
  "ৌ": "ou",
};
const CONSONANTS: Record<string, string> = {
  ক: "k",
  খ: "kh",
  গ: "g",
  ঘ: "gh",
  ঙ: "ng",
  চ: "ch",
  ছ: "chh",
  জ: "j",
  ঝ: "jh",
  ঞ: "n",
  ট: "t",
  ঠ: "th",
  ড: "d",
  ঢ: "dh",
  ণ: "n",
  ত: "t",
  থ: "th",
  দ: "d",
  ধ: "dh",
  ন: "n",
  প: "p",
  ফ: "f",
  ব: "b",
  ভ: "bh",
  ম: "m",
  য: "j",
  র: "r",
  ল: "l",
  শ: "sh",
  ষ: "sh",
  স: "s",
  হ: "h",
  ৎ: "t",
};
// ড় ঢ় য় by code point: NFC decomposes them into consonant + nukta, and source files
// may be renormalised, so never rely on literal characters for these.
const RRA = String.fromCharCode(0x09dc);
const RHA = String.fromCharCode(0x09dd);
const YYA = String.fromCharCode(0x09df);
const NUKTA = String.fromCharCode(0x09bc);
CONSONANTS[RRA] = "r";
CONSONANTS[RHA] = "rh";
CONSONANTS[YYA] = "y";
const MARKS: Record<string, string> = { "ং": "ng", "ঃ": "h", "ঁ": "n" };
const HASANT = String.fromCharCode(0x09cd);
const isBangla = (c: string | undefined) => c !== undefined && c >= "ঀ" && c <= "৿";

/**
 * Bangla text → rough Latin ("জামদানি শাড়ি" → "jamdani shari"). Other characters
 * pass through. Simplified schwa rule: a consonant's inherent "o" is written only
 * for a word's first consonant when another consonant follows ("ঘর" → "ghor").
 */
export function transliterateBangla(input: string): string {
  const s = input
    .normalize("NFC")
    .replaceAll(String.fromCharCode(0x09a1) + NUKTA, RRA)
    .replaceAll(String.fromCharCode(0x09a2) + NUKTA, RHA)
    .replaceAll(String.fromCharCode(0x09af) + NUKTA, YYA);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const next = s[i + 1];
    if (ch in CONSONANTS) {
      out += CONSONANTS[ch];
      const wordStart = !isBangla(s[i - 1]);
      if (wordStart && next !== undefined && next in CONSONANTS) out += "o";
    } else if (ch in SIGNS) out += SIGNS[ch];
    else if (ch in VOWELS) out += VOWELS[ch];
    else if (ch in MARKS) out += MARKS[ch];
    else if (ch === HASANT || ch === NUKTA) continue;
    else if (/[০-৯]/.test(ch)) out += String(ch.charCodeAt(0) - 0x09e6);
    else out += ch;
  }
  return out;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function randomSlug(length = 6, random: () => number = Math.random): string {
  return Array.from({ length }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
}

/** The base slug for a record: English → transliterated Bangla → random. */
export function baseSlug(en: string | null | undefined, bn: string | null | undefined): string {
  return slugify(en ?? "") || slugify(transliterateBangla(bn ?? "")) || `item-${randomSlug()}`;
}

/** `base` if free, else base-2, base-3, … (trimmed so the suffix still fits in SLUG_MAX). */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
