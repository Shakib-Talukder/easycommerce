/**
 * Money is integer poisha everywhere (1 BDT = 100 poisha). Parsing never goes
 * through floating-point arithmetic.
 */

/** Bangla digits (০–৯) to ASCII, so input typed on a Bangla keyboard parses. */
export function normalizeDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

/** "1,250.5" | "১২৫০" | 1250.5 -> 125050. Throws on more than 2 decimals or negatives. */
export function takaToPoisha(input: string | number): number {
  const raw = normalizeDigits(typeof input === "number" ? input.toString() : input).replace(/[,\s৳]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error(`Invalid taka amount: ${String(input)}`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const poisha = whole * 100 + fraction;
  if (!Number.isSafeInteger(poisha)) throw new Error(`Amount out of range: ${String(input)}`);
  return poisha;
}

/** 125050 -> "1250.50" */
export function poishaToTakaString(poisha: number): string {
  assertPoisha(poisha);
  const sign = poisha < 0 ? "-" : "";
  const abs = Math.abs(poisha);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 125050 -> "BDT 1,250.50"-style output, localised for bn or en. */
export function formatBDT(poisha: number, language: "bn" | "en" = "en"): string {
  assertPoisha(poisha);
  return new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
  }).format(poisha / 100);
}

export function assertPoisha(value: number): void {
  if (!Number.isSafeInteger(value))
    throw new Error(`Money must be an integer number of poisha, got ${value}`);
}
