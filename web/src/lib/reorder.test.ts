import { describe, expect, it } from "vitest";
import { dropIndex, shiftOf } from "./reorder";

describe("dropIndex", () => {
  it("counts the rows whose middle is above the dragged row's middle", () => {
    const middles = [10, 30, 50];
    expect(dropIndex(middles, 0)).toBe(0);
    expect(dropIndex(middles, 20)).toBe(1);
    expect(dropIndex(middles, 49)).toBe(2);
    expect(dropIndex(middles, 99)).toBe(3);
    expect(dropIndex([], 5)).toBe(0);
  });
});

describe("shiftOf", () => {
  // Rows 0..3; row 1 is dragged.
  it("moves rows below up when the row goes down past them", () => {
    // To the gap after the others' index 1 (old row 2): row 2 slides up, row 3 stays.
    expect(shiftOf(2, 1, 2, 20)).toBe(-20);
    expect(shiftOf(3, 1, 2, 20)).toBe(0);
    expect(shiftOf(0, 1, 2, 20)).toBe(0);
  });

  it("moves rows above down when the row goes up past them", () => {
    expect(shiftOf(0, 1, 0, 20)).toBe(20);
    expect(shiftOf(2, 1, 0, 20)).toBe(0);
  });

  it("leaves everything (and the dragged row) alone where it started", () => {
    for (const index of [0, 1, 2, 3]) expect(shiftOf(index, 1, 1, 20)).toBe(0);
  });
});
