import { describe, expect, it } from "vitest";
import { clampToVisible } from "./window-bounds";

const main = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };

describe("clampToVisible", () => {
  it("leaves a window that is on a screen alone", () => {
    const rect = { x: 100, y: 100, width: 340, height: 480 };
    expect(clampToVisible(rect, [main])).toEqual(rect);
  });

  it("leaves a window on the second screen alone, and one that sticks out a bit", () => {
    const onSecond = { x: 2000, y: 50, width: 340, height: 480 };
    expect(clampToVisible(onSecond, [main, second])).toEqual(onSecond);
    const sticking = { x: 1800, y: 900, width: 340, height: 480 };
    expect(clampToVisible(sticking, [main])).toEqual(sticking);
  });

  it("brings back a window whose screen was unplugged, centred on the main screen", () => {
    const lost = { x: 2000, y: 50, width: 340, height: 480 };
    expect(clampToVisible(lost, [main])).toEqual({ x: 790, y: 300, width: 340, height: 480 });
  });

  it("brings back a window that is only a sliver on a screen", () => {
    const sliver = { x: 1900, y: 100, width: 340, height: 480 };
    expect(clampToVisible(sliver, [main]).x).toBe(790);
    const above = { x: 100, y: -470, width: 340, height: 480 };
    expect(clampToVisible(above, [main]).y).toBe(300);
  });

  it("makes a window that is bigger than the screen fit it", () => {
    const huge = { x: -5000, y: -5000, width: 4000, height: 3000 };
    expect(clampToVisible(huge, [main])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("copes with a short, collapsed window and with no screen information", () => {
    const strip = { x: 100, y: 100, width: 340, height: 44 };
    expect(clampToVisible(strip, [main])).toEqual(strip);
    expect(clampToVisible(strip, [])).toEqual(strip);
  });
});
