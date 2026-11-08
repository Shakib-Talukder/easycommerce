import localFont from "next/font/local";

/*
 * Self-hosted fonts from @fontsource (woff2 in node_modules), so `next build`
 * never fetches from fonts.googleapis.com and works offline. Only the weights
 * the UI uses (next/font needs literal arguments, hence the repetition): 400 (normal), 500 (medium), 600 (semibold), 700 (bold).
 * next/font still generates metric-matched fallbacks, so swapping doesn't shift layout.
 */

export const latin = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-latin",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const bengali = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-bengali",
  display: "swap",
  // Only Bangla text uses it; Latin text keeps Inter.
  preload: false,
});
