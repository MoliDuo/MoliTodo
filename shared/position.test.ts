import { describe, expect, it } from "vitest";
import { positionAfter, positionBetween } from "./position";

const valid = (key: string) => /^[0-9A-Za-z]+$/.test(key) && !key.endsWith("0");

describe("positionBetween", () => {
  it("starts a list", () => {
    expect(valid(positionBetween(null, null))).toBe(true);
  });

  it("puts a key before the first, after the last, and between two", () => {
    const first = positionBetween(null, null);
    const before = positionBetween(null, first);
    const after = positionBetween(first, null);
    expect(before < first && first < after).toBe(true);
    const middle = positionBetween(first, after);
    expect(first < middle && middle < after).toBe(true);
  });

  it("refuses neighbours in the wrong order", () => {
    expect(() => positionBetween("b", "a")).toThrow();
    expect(() => positionBetween("a", "a")).toThrow();
  });

  it("handles neighbours whose first digits are next to each other", () => {
    for (const [a, b] of [
      ["1", "2"],
      ["z", null],
      ["1z", "2"],
      ["", "1"],
      ["0V", "1"],
    ] as const) {
      const key = positionBetween(a || null, b);
      expect(key > a && (b === null || key < b) && valid(key)).toBe(true);
    }
  });

  it("keeps ordering over thousands of random insertions, at either end and in the middle", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const keys: string[] = [];
    for (let step = 0; step < 4000; step += 1) {
      const slot = Math.floor(random() * (keys.length + 1));
      const key = positionBetween(keys[slot - 1] ?? null, keys[slot] ?? null);
      expect(valid(key)).toBe(true);
      keys.splice(slot, 0, key);
    }
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("appends many tasks without the keys growing out of hand", () => {
    let last: string | null = null;
    for (let step = 0; step < 500; step += 1) last = positionAfter(last);
    expect((last as string).length).toBeLessThan(120);
  });
});
