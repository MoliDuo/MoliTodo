import { describe, expect, it } from "vitest";
import {
  applyTheme,
  contrast,
  DEFAULT_ACCENT,
  isDark,
  mix,
  normalizeHex,
  readable,
  textOn,
  themeColors,
} from "./theme";

describe("theme colours", () => {
  it("reads colour codes the ways people type them", () => {
    expect(normalizeHex("#A34E00")).toBe("#a34e00");
    expect(normalizeHex(" a34e00 ")).toBe("#a34e00");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    for (const bad of ["", "#12345", "zzzzzz", "#1234567", "red"]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });

  it("measures contrast and mixes", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("picks readable text for a fill", () => {
    expect(textOn("#a34e00")).toBe("#ffffff");
    expect(textOn("#f9e27a")).toBe("#18181b");
  });

  it("darkens a pale colour for text, and lifts a dark one in dark mode", () => {
    const pale = "#f6c6d2";
    expect(contrast(readable(pale, "#ffffff", 3.6), "#ffffff")).toBeGreaterThanOrEqual(3.6);
    const light = themeColors(pale, false);
    expect(light.accent).toBe(pale);
    expect(contrast(light.ink, "#ffffff")).toBeGreaterThanOrEqual(3.6);
    const dark = themeColors("#2a1a5e", true);
    expect(contrast(dark.accent, "#141414")).toBeGreaterThanOrEqual(2.2);
    expect(themeColors(null, false).accent).toBe(DEFAULT_ACCENT);
  });

  it("gives up at black or white when nothing else is readable", () => {
    expect(readable("#ffffff", "#ffffff", 30)).toBe("#000000");
  });

  it("follows the system only when asked to", () => {
    expect(isDark("system", true)).toBe(true);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("dark", false)).toBe(true);
  });

  it("puts the colours on the page", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    applyTheme({ accent: "#3f7d5c", theme: "dark", cover: "monet" }, false);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.body.style.getPropertyValue("--moli-accent")).not.toBe("");
    expect(meta.getAttribute("content")).toBe("#141414");
    applyTheme({ accent: null, theme: "system", cover: "monet" }, false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.body.style.getPropertyValue("--moli-accent")).toBe(DEFAULT_ACCENT);
    meta.remove();
  });

  it("gives the book's case its own colour only when one is chosen", () => {
    applyTheme({ accent: null, theme: "light", cover: "monet", caseColor: "#2f7f8f" }, false);
    expect(document.body.style.getPropertyValue("--case-color")).toBe("#2f7f8f");
    applyTheme({ accent: null, theme: "light", cover: "monet", caseColor: null }, false);
    expect(document.body.style.getPropertyValue("--case-color")).toBe("");
  });
});
