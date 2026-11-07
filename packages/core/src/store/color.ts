/** Colour helpers shared by the server and the branding UI (no dependencies). */

export type Palette = { id: string; primary: string; secondary: string };

/** Preset palettes for the branding step. Each primary passes WCAG AA with white text. */
export const PALETTES: readonly Palette[] = [
  { id: "green", primary: "#15803d", secondary: "#facc15" },
  { id: "teal", primary: "#0f766e", secondary: "#f59e0b" },
  { id: "blue", primary: "#1d4ed8", secondary: "#38bdf8" },
  { id: "indigo", primary: "#4338ca", secondary: "#f472b6" },
  { id: "rose", primary: "#be123c", secondary: "#fbbf24" },
  { id: "orange", primary: "#c2410c", secondary: "#fde68a" },
  { id: "purple", primary: "#7e22ce", secondary: "#a3e635" },
  { id: "slate", primary: "#334155", secondary: "#f97316" },
];

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for normal-size text. */
export const AA_CONTRAST = 4.5;

/** Whether white text (buttons, header) on `background` meets AA. */
export function whiteTextPassesAA(background: string): boolean {
  return contrastRatio(background, "#ffffff") >= AA_CONTRAST;
}
