// The theme colour she picks. Fills (buttons, the selected tab, the book's case) use it exactly; text in that
// colour (tags, links) uses a version dark or light enough to read; in dark mode both are lifted as needed.

import type { SettingsData } from "@shared/records";

/** The app's own accent (tokens.css, `[data-app="todo"]`). */
export const DEFAULT_ACCENT = "#a34e00";

export const PRESETS: { color: string; name: string }[] = [
  { color: "#a34e00", name: "琥珀" },
  { color: "#d4a24c", name: "麦穗" },
  { color: "#8a6bb0", name: "鸢尾" },
  { color: "#b04a6c", name: "莓果" },
  { color: "#e07a8f", name: "樱花" },
  { color: "#3f7d5c", name: "松针" },
  { color: "#2f7f8f", name: "湖水" },
  { color: "#4466bb", name: "群青" },
  { color: "#5b6170", name: "石墨" },
  { color: "#8c6a4f", name: "可可" },
];

/** "#a34e00" from "#A34E00", "a34e00", "#abc" or "abc"; null when it is not a colour code. */
export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
  if (/^[0-9a-f]{3}$/.test(text)) return `#${[...text].map((c) => c + c).join("")}`;
  return null;
}

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color` mixed toward `toward` by `amount` (0 to 1). */
export function mix(color: string, toward: string, amount: number): string {
  const a = toRgb(color);
  const b = toRgb(toward);
  return toHex(a.map((c, i) => c + ((b[i] as number) - c) * amount) as Rgb);
}

/** Text colour for words written on a fill of `color`. */
export const textOn = (color: string): string =>
  contrast(color, "#ffffff") >= contrast(color, "#18181b") ? "#ffffff" : "#18181b";

/** `color` moved toward `toward` in small steps until it reaches `ratio` against `background`. */
export function readable(color: string, background: string, ratio: number): string {
  const toward = luminance(background) > 0.5 ? "#000000" : "#ffffff";
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(color, toward, step / 20);
    if (contrast(candidate, background) >= ratio) return candidate;
  }
  return toward;
}

export interface ThemeColors {
  accent: string;
  accentFg: string;
  /** For text and thin lines in the accent colour. */
  ink: string;
}

const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#141414";

export function themeColors(accent: string | null, dark: boolean): ThemeColors {
  const base = accent ?? DEFAULT_ACCENT;
  const surface = dark ? DARK_SURFACE : LIGHT_SURFACE;
  const fill = dark ? readable(base, surface, 2.2) : base;
  return { accent: fill, accentFg: textOn(fill), ink: readable(base, surface, 3.6) };
}

export const isDark = (theme: SettingsData["theme"], systemDark: boolean): boolean =>
  theme === "dark" || (theme === "system" && systemDark);

/** Puts the colours on the page. The body carries `data-app="todo"`, so its own style wins over tokens.css. */
export function applyTheme(settings: SettingsData, systemDark: boolean, doc: Document = document) {
  const dark = isDark(settings.theme, systemDark);
  const colors = themeColors(settings.accent, dark);
  doc.documentElement.dataset.theme = dark ? "dark" : "light";
  const style = doc.body.style;
  style.setProperty("--moli-accent", colors.accent);
  style.setProperty("--moli-accent-fg", colors.accentFg);
  style.setProperty("--accent-ink", colors.ink);
  doc
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#141414" : "#ffffff");
}
