import { describe, expect, it } from "vitest";
import { minuteTicks, polar, slicePath, smoothPath } from "./chart";

describe("minuteTicks", () => {
  it("uses round steps", () => {
    expect(minuteTicks(0)).toEqual([0, 5]);
    expect(minuteTicks(250)).toEqual([0, 60, 120, 180, 240, 300]);
    expect(minuteTicks(800)).toEqual([0, 180, 360, 540, 720, 900]);
    expect(minuteTicks(100000).length).toBeLessThanOrEqual(6);
  });
});

describe("smoothPath", () => {
  it("draws nothing, a point, or curves through every point", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1,2");
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
      { x: 30, y: 10 },
    ]);
    expect(d.startsWith("M0,10 C")).toBe(true);
    expect(d.endsWith("30,10")).toBe(true);
    // Flat stretch: control points stay on the floor.
    expect(d).toContain("C23.33,10 26.67,10 30,10");
  });
});

describe("pie", () => {
  it("starts at twelve o'clock and goes clockwise", () => {
    const top = polar(0, 0, 10, 0);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(-10);
    expect(polar(0, 0, 10, 0.25).x).toBeCloseTo(10);
  });

  it("draws slices and a whole circle", () => {
    expect(slicePath(0, 0, 10, 0, 0.25)).toMatch(/^M0,0 L.* A10,10 0 0 1 .* Z$/);
    expect(slicePath(0, 0, 10, 0, 0.75)).toContain(" 0 1 1 ");
    expect(slicePath(0, 0, 10, 0, 1)).not.toContain("L");
  });
});
