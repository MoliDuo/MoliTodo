import { describe, expect, it } from "vitest";
import {
  apply,
  arcPoint,
  clampPoint,
  clipHalfPlane,
  compose,
  curl,
  matrixCss,
  pointsAttr,
  polygonCss,
  ROLL_STRIPS,
  rollRadius,
  squash,
  turnedPoint,
  type Point,
} from "./page-curl";

const W = 300;
const H = 400;

const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

const area = (poly: Point[]) =>
  Math.abs(
    poly.reduce((sum, p, i) => {
      const q = poly[(i + 1) % poly.length] as Point;
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );

describe("clipHalfPlane", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it("keeps the side the normal points to", () => {
    const right = clipHalfPlane(square, { x: 5, y: 0 }, { x: 1, y: 0 });
    expect(area(right)).toBeCloseTo(50);
    expect(right.every((p) => p.x >= 5 - 1e-9)).toBe(true);
  });
  it("keeps all or nothing when the line misses", () => {
    expect(clipHalfPlane(square, { x: -1, y: 0 }, { x: 1, y: 0 })).toHaveLength(4);
    expect(clipHalfPlane(square, { x: 11, y: 0 }, { x: 1, y: 0 })).toHaveLength(0);
  });
});

describe("clampPoint", () => {
  it("leaves reachable points alone", () => {
    close(clampPoint({ x: 100, y: 300 }, "bottom", W, H), { x: 100, y: 300 });
  });
  it("keeps the corner within a page width of the spine's near end", () => {
    const p = clampPoint({ x: W + 200, y: H + 200 }, "bottom", W, H);
    expect(Math.hypot(p.x, p.y - H)).toBeLessThanOrEqual(W + 1e-9);
  });
  it("keeps the corner within the diagonal of the spine's far end", () => {
    const p = clampPoint({ x: 0, y: -400 }, "bottom", W, H);
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(Math.hypot(W, H) + 1e-9);
    const top = clampPoint({ x: 10, y: -500 }, "top", W, H);
    expect(Math.hypot(top.x, top.y)).toBeLessThanOrEqual(W + 1e-9);
  });
});

describe("curl", () => {
  it("is flat when the corner has not moved", () => {
    expect(curl({ x: W, y: H }, "bottom", "right", W, H)).toBeNull();
  });

  it("splits the page into a flat part, a roll and a lifted part that add up to the page", () => {
    const c = curl({ x: 180, y: 330 }, "bottom", "right", W, H)!;
    expect(c.radius).toBeGreaterThan(0);
    expect(c.strips).toHaveLength(1 + ROLL_STRIPS);
    const total =
      area(c.front) + area(c.backClip) + c.strips.reduce((sum, s) => sum + area(s.clip), 0);
    // The roll's slices overlap a little on screen (more before squeezing) so no hairline shows.
    expect(total).toBeGreaterThanOrEqual(W * H - 1e-6);
    expect(total).toBeLessThan(W * H + (ROLL_STRIPS + 1) * 7.5 * Math.hypot(W, H));
    expect(area(c.flap)).toBeCloseTo(area(c.backClip));
    expect(c.progress).toBeGreaterThan(0);
    expect(c.progress).toBeLessThan(1);
  });

  it("lays the lifted corner exactly on the finger", () => {
    const p = { x: 150, y: 350 };
    const c = curl(p, "bottom", "right", W, H)!;
    // The back's own (0, H) is the corner behind the front's (W, H).
    close(apply(c.backMatrix, { x: 0, y: H }), p);
  });

  it("rolls the lifted part round a cylinder, each slice meeting the next", () => {
    const c = curl({ x: 150, y: 350 }, "bottom", "right", W, H)!;
    const r = c.radius;
    const n = c.normal;
    expect(r).toBeGreaterThan(0);
    // A point s past the roll's start, on the line through the roll point; a right page's stage is canonical.
    const at = (s: number) => ({ x: c.roll.x + n.x * s, y: c.roll.y + n.y * s });
    const behind = (q: Point) => ({ x: W - q.x, y: q.y });
    const [inside, ...slices] = c.strips;
    expect(inside!.face).toBe("front");
    close(apply(inside!.matrix, at(0)), at(0));
    close(apply(inside!.matrix, at((Math.PI * r) / 2)), at(r));
    slices.forEach((slice, i) => {
      expect(slice.face).toBe("back");
      const a = Math.PI / 2 + (i * Math.PI) / 2 / ROLL_STRIPS;
      const b = a + Math.PI / 2 / ROLL_STRIPS;
      close(apply(slice.matrix, behind(at(r * a))), at(r * Math.sin(a)));
      close(apply(slice.matrix, behind(at(r * b))), at(r * Math.sin(b)));
    });
    // Past the roll the back lies flat, starting where the last slice ends.
    close(apply(c.backMatrix, behind(at(Math.PI * r))), at(0));
  });

  it("puts a fully turned right page flat on the left", () => {
    const c = curl(turnedPoint("bottom", W, H), "bottom", "right", W, H)!;
    expect(c.progress).toBeCloseTo(1);
    expect(c.radius).toBe(0);
    expect(c.strips.every((s) => s.clip.length === 0 && s.area.length === 0)).toBe(true);
    close(apply(c.backMatrix, { x: 0, y: 0 }), { x: -W, y: 0 });
    close(apply(c.backMatrix, { x: W, y: H }), { x: 0, y: H });
    expect(area(c.front)).toBeCloseTo(0);
  });

  it("mirrors a left page: fully turned, its back lies flat on the right", () => {
    const c = curl(turnedPoint("top", W, H), "top", "left", W, H)!;
    close(apply(c.backMatrix, { x: 0, y: 0 }), { x: 0, y: 0 });
    close(apply(c.backMatrix, { x: W, y: H }), { x: W, y: H });
    // The uncovered part is on the left, past the spine.
    expect(c.normal.x).toBeLessThan(0);
  });

  it("keeps the front of a left page in its own coordinates", () => {
    const c = curl({ x: 200, y: 380 }, "bottom", "left", W, H)!;
    expect(c.front.every((p) => p.x >= -1e-9 && p.x <= W + 1e-9)).toBe(true);
    expect(c.uncovered.every((p) => p.x <= 1e-9)).toBe(true);
  });

  it("gives both ends of the fold on the page's edges", () => {
    const c = curl({ x: 200, y: 300 }, "bottom", "right", W, H)!;
    for (const end of c.fold) {
      const onEdge =
        Math.abs(end.x) < 1e-6 ||
        Math.abs(end.x - W) < 1e-6 ||
        Math.abs(end.y) < 1e-6 ||
        Math.abs(end.y - H) < 1e-6;
      expect(onEdge).toBe(true);
    }
  });
});

describe("rollRadius", () => {
  it("is nothing while the page lies nearly flat, and most half way over", () => {
    expect(rollRadius(100, 0, W)).toBe(0);
    expect(rollRadius(2 * W, 1, W)).toBe(0);
    expect(rollRadius(W, 0.5, W)).toBeCloseTo(36);
    expect(rollRadius(W, 0.5, 50)).toBeCloseTo(14);
    expect(rollRadius(W, 0.5, 1000)).toBeCloseTo(48);
  });
  it("never keeps the corner on the roll", () => {
    expect(rollRadius(30, 0.5, W)).toBeCloseTo(30 / Math.PI);
  });
});

describe("helpers", () => {
  it("squashes along a line, and reflects across it", () => {
    const n = { x: 0, y: 1 };
    close(apply(squash({ x: 0, y: 10 }, n, 0.5, 2), { x: 3, y: 30 }), { x: 3, y: 22 });
    close(apply(squash({ x: 0, y: 10 }, n, -1, 0), { x: 3, y: 30 }), { x: 3, y: -10 });
  });

  it("composes matrices like functions", () => {
    const move = [1, 0, 0, 1, 5, 0] as const;
    const double = [2, 0, 0, 2, 0, 0] as const;
    close(apply(compose([...move], [...double]), { x: 1, y: 1 }), { x: 7, y: 2 });
  });

  it("writes CSS and SVG", () => {
    expect(polygonCss([{ x: 1.234, y: 2 }])).toBe("polygon(1.23px 2px)");
    expect(matrixCss([1, 0, 0, 1, 0.5, 0])).toBe("matrix(1, 0, 0, 1, 0.5, 0)");
    expect(pointsAttr([{ x: 1, y: 2 }])).toBe("1,2");
  });

  it("arcs an automatic turn upward between its ends", () => {
    const from = { x: 300, y: 400 };
    const to = { x: -300, y: 400 };
    close(arcPoint(from, to, 0, 50), from);
    close(arcPoint(from, to, 1, 50), to);
    expect(arcPoint(from, to, 0.4, 50).y).toBeLessThan(400);
    close(arcPoint(from, to, 0.5, 0), { x: 0, y: 400 });
  });
});
