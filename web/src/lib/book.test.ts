import { describe, expect, it } from "vitest";
import {
  backOf,
  canTurn,
  dragPoint,
  endTurn,
  facesAt,
  leftOf,
  makeBook,
  pagesAt,
  positionOf,
  rightOf,
  settle,
  startTurn,
} from "./book";
import { addTask } from "./model";
import { SyncEngine } from "./sync";

const engine = () =>
  new SyncEngine({
    transport: {
      put: async () => ({ kind: "conflict", record: null }),
      changes: async (cursor) => ({ records: [], cursor, hasMore: false }),
    },
  });

const W = 300;
const H = 400;

describe("makeBook", () => {
  it("has a page for each written day of the year, numbered over all years", () => {
    const e = engine();
    addTask(e, "2025-12-31", { text: "old" });
    addTask(e, "2026-10-04", { text: "b" });
    addTask(e, "2026-10-04", { text: "c" });
    addTask(e, "2026-10-04", { text: "a", after: null });
    addTask(e, "2026-10-03", { text: "x" });
    addTask(e, "2026-10-05", { text: "  " });
    const book = makeBook(e, 2026, 2026);
    expect(book.pages.map((p) => [p.day, p.number])).toEqual([
      ["2026-10-03", 2],
      ["2026-10-04", 3],
    ]);
    expect(book.pages[1]?.tasks.map((t) => t.data.text)).toEqual(["a", "b", "c"]);
    expect(book.lines).toBe(4);
    expect(book.years).toEqual([2026, 2025]);
    expect(makeBook(e, 2027, 2027).years).toEqual([2027, 2026, 2025]);
  });
});

describe("leaves", () => {
  it("puts one day on each leaf on a phone", () => {
    expect(positionOf("single", 3)).toBe(3);
    expect(pagesAt("single", 5, 3)).toEqual([3]);
    expect(rightOf("single", 5, 3)).toEqual({ type: "page", index: 3 });
    expect(rightOf("single", 5, 5)).toEqual({ type: "endpaper" });
    expect(backOf("single", 5, 3)).toEqual({ type: "blank", ghost: 3 });
    expect(leftOf("single", 5, 0)).toEqual({ type: "endpaper" });
    expect(leftOf("single", 5, 2)).toEqual({ type: "blank", ghost: 1 });
  });

  it("puts two days on each leaf on a wide screen", () => {
    expect(positionOf("spread", 0)).toBe(0);
    expect(positionOf("spread", 1)).toBe(1);
    expect(positionOf("spread", 2)).toBe(1);
    expect(pagesAt("spread", 4, 1)).toEqual([1, 2]);
    expect(pagesAt("spread", 2, 1)).toEqual([1]);
    expect(rightOf("spread", 4, 1)).toEqual({ type: "page", index: 2 });
    expect(backOf("spread", 4, 1)).toEqual({ type: "page", index: 3 });
    expect(backOf("spread", 3, 1)).toEqual({ type: "blank", ghost: null });
    expect(leftOf("spread", 4, 1)).toEqual({ type: "page", index: 1 });
  });

  it("knows when there is somewhere to turn to", () => {
    expect(canTurn("single", 3, 0, "prev")).toBe(false);
    expect(canTurn("single", 3, 1, "prev")).toBe(true);
    expect(canTurn("single", 3, 1, "next")).toBe(true);
    expect(canTurn("single", 3, 2, "next")).toBe(false);
    expect(canTurn("spread", 2, 0, "next")).toBe(true);
    expect(canTurn("spread", 2, 1, "next")).toBe(false);
    expect(canTurn("spread", 3, 1, "next")).toBe(false);
  });
});

describe("turns", () => {
  it("turns the right page forward, starting flat", () => {
    const turn = startTurn("single", 2, "next", "bottom", W, H);
    expect(turn).toMatchObject({ leaf: 2, side: "right", reverse: false, point: { x: W, y: H } });
    expect(dragPoint(turn, { x: -100, y: -20 }, W, H)).toEqual({ x: 200, y: 380 });
    expect(endTurn(turn, "turned")).toBe(3);
    expect(endTurn(turn, "flat")).toBe(2);
  });

  it("turns back on a phone by running the previous leaf's turn in reverse", () => {
    const turn = startTurn("single", 2, "prev", "top", W, H);
    expect(turn).toMatchObject({ leaf: 1, side: "right", reverse: true, point: { x: -W, y: 0 } });
    expect(dragPoint(turn, { x: 100, y: 10 }, W, H).x).toBeCloseTo(-100, 0);
    expect(endTurn(turn, "flat")).toBe(1);
    expect(endTurn(turn, "turned")).toBe(2);
  });

  it("turns the left page back on a wide screen, mirrored", () => {
    const turn = startTurn("spread", 2, "prev", "bottom", W, H);
    expect(turn).toMatchObject({ leaf: 1, side: "left", reverse: false });
    expect(dragPoint(turn, { x: 100, y: 0 }, W, H)).toEqual({ x: 200, y: H });
    expect(endTurn(turn, "turned")).toBe(1);
    expect(endTurn(turn, "flat")).toBe(2);
  });

  it("finishes on a flick or past the middle", () => {
    const forward = startTurn("single", 0, "next", "bottom", W, H);
    expect(settle(forward, 0.1, -0.6)).toBe("turned");
    expect(settle(forward, 0.9, 0.6)).toBe("flat");
    expect(settle(forward, 0.4, 0)).toBe("turned");
    expect(settle(forward, 0.2, 0)).toBe("flat");
    const back = startTurn("single", 1, "prev", "bottom", W, H);
    expect(settle(back, 0.5, 0)).toBe("flat");
    expect(settle(back, 0.8, 0)).toBe("turned");
    const left = startTurn("spread", 1, "prev", "bottom", W, H);
    expect(settle(left, 0, 0.6)).toBe("turned");
  });

  it("says which page lies where during a turn", () => {
    expect(facesAt("single", 3, 1, null)).toEqual({
      left: { type: "blank", ghost: 0 },
      right: { type: "page", index: 1 },
      front: null,
      back: null,
      leftLeaves: 1,
      rightLeaves: 2,
    });
    const forward = facesAt("spread", 5, 1, startTurn("spread", 1, "next", "top", W, H));
    expect(forward).toMatchObject({
      left: { type: "page", index: 1 },
      right: { type: "page", index: 4 },
      front: { type: "page", index: 2 },
      back: { type: "page", index: 3 },
      leftLeaves: 1,
      rightLeaves: 1,
    });
    const backward = facesAt("spread", 5, 1, startTurn("spread", 1, "prev", "top", W, H));
    expect(backward).toMatchObject({
      left: { type: "endpaper" },
      right: { type: "page", index: 2 },
      front: { type: "page", index: 1 },
      back: { type: "page", index: 0 },
    });
  });
});
