import localFont from "next/font/local";

// Files come from fontsource (copied, so next/font can preload them and size the fallbacks to
// match, which keeps text from shifting when the fonts arrive). The Shippori file is subset to
// the two glyphs of 軌跡: 1.6 KB instead of 2 MB.
export const inter = localFont({
  src: "./inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const commitMono = localFont({
  src: [
    { path: "./commit-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./commit-mono-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-commit",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["ui-monospace", "monospace"],
});

export const shippori = localFont({
  src: [
    { path: "./shippori-mincho-b1-latin-800-normal.woff2", weight: "800" },
    { path: "./shippori-kiseki-800.woff2", weight: "800" },
  ],
  variable: "--font-shippori",
  display: "swap",
});
