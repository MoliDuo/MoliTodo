// Geometry of a page being turned by its corner, like paper rather than a stiff card.
//
// Everything is worked out in "canonical" coordinates: the page lies on [0, W] x [0, H] with the spine at x = 0,
// and the free corner C (top or bottom right) is pulled to the point P. The fold is the line halfway between C
// and P, at right angles to C-P. The part of the page on C's side of the fold is lifted and laid over, mirrored
// across the fold: there the back of the page shows. A left-hand page is the same picture mirrored.

export interface Point {
  x: number;
  y: number;
}

export type Corner = "top" | "bottom";
export type Side = "right" | "left";

/** CSS `matrix(a, b, c, d, e, f)`: (x, y) -> (a x + c y + e, b x + d y + f). */
export type Matrix = [number, number, number, number, number, number];

export interface Curl {
  /** The part of the front still lying flat, in the front page's own coordinates. */
  front: Point[];
  /** The lifted part, in the back page's own coordinates (what to show of it). */
  backClip: Point[];
  /** Places the back page: from its own coordinates to stage coordinates (spine at x = 0). */
  backMatrix: Matrix;
  /** The lifted part where it lies now, in stage coordinates. */
  flap: Point[];
  /** The part of the page underneath that the lifted part uncovered, in stage coordinates. */
  uncovered: Point[];
  /** Both ends of the fold, in stage coordinates. */
  fold: [Point, Point];
  /** Unit vector at right angles to the fold, pointing into the uncovered part, in stage coordinates. */
  normal: Point;
  /** 0 when flat, 1 when fully turned. */
  progress: number;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const length = (a: Point) => Math.hypot(a.x, a.y);

export const cornerPoint = (corner: Corner, w: number, h: number): Point => ({
  x: w,
  y: corner === "top" ? 0 : h,
});

/** Where the corner ends when the page is fully turned. */
export const turnedPoint = (corner: Corner, w: number, h: number): Point => ({
  x: -w,
  y: corner === "top" ? 0 : h,
});

/**
 * Keeps P where the corner can really go: paper does not stretch, so the corner stays within the page's width
 * of the spine's near end and within the diagonal of its far end.
 */
export function clampPoint(p: Point, corner: Corner, w: number, h: number): Point {
  const near = { x: 0, y: corner === "top" ? 0 : h };
  const far = { x: 0, y: corner === "top" ? h : 0 };
  let point = { ...p };
  const toNear = sub(point, near);
  if (length(toNear) > w) {
    const k = w / length(toNear);
    point = { x: near.x + toNear.x * k, y: near.y + toNear.y * k };
  }
  const diagonal = Math.hypot(w, h);
  const toFar = sub(point, far);
  if (length(toFar) > diagonal) {
    const k = diagonal / length(toFar);
    point = { x: far.x + toFar.x * k, y: far.y + toFar.y * k };
  }
  return point;
}

/** The part of a convex polygon where (q - origin) . normal >= 0 (Sutherland-Hodgman, one edge). */
export function clipHalfPlane(polygon: Point[], origin: Point, normal: Point): Point[] {
  const side = (q: Point) => dot(sub(q, origin), normal);
  const result: Point[] = [];
  polygon.forEach((current, i) => {
    const previous = polygon[(i + polygon.length - 1) % polygon.length] as Point;
    const a = side(previous);
    const b = side(current);
    if (b >= 0) {
      if (a < 0) result.push(intersect(previous, current, a, b));
      result.push(current);
    } else if (a >= 0) {
      result.push(intersect(previous, current, a, b));
    }
  });
  return result;
}

const intersect = (p: Point, q: Point, a: number, b: number): Point => {
  const t = a / (a - b);
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
};

/** Reflection across the line through `origin` with unit normal `n`, as a matrix. */
function reflection(origin: Point, n: Point): Matrix {
  const a = 1 - 2 * n.x * n.x;
  const b = -2 * n.x * n.y;
  const d = 1 - 2 * n.y * n.y;
  const k = 2 * dot(origin, n);
  return [a, b, b, d, k * n.x, k * n.y];
}

/** m1 after m2. */
export function compose(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export const apply = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** Stage x -> -x: turns the right-hand picture into the left-hand one. */
const MIRROR: Matrix = [-1, 0, 0, 1, 0, 0];

/**
 * The curl for a page of size w x h whose corner is at canonical point `p`. `side` is the page being turned:
 * a right-hand page turns forward, a left-hand page backward. Returns null when the page lies flat.
 */
export function curl(p: Point, corner: Corner, side: Side, w: number, h: number): Curl | null {
  const c = cornerPoint(corner, w, h);
  const point = clampPoint(p, corner, w, h);
  const toCorner = sub(c, point);
  const distance = length(toCorner);
  if (distance < 0.5) return null;
  const normal = { x: toCorner.x / distance, y: toCorner.y / distance };
  const middle = { x: (c.x + point.x) / 2, y: (c.y + point.y) / 2 };
  const page = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const lifted = clipHalfPlane(page, middle, normal);
  const flat = clipHalfPlane(page, middle, { x: -normal.x, y: -normal.y });
  if (lifted.length < 3) return null;

  const reflect = reflection(middle, normal);
  // The page's back seen from the front: (u, v) on the back sits behind (w - u, v) on the front.
  const flipX: Matrix = [-1, 0, 0, 1, w, 0];
  // Own coordinates of each face, from canonical: a right page's front is canonical, its back is flipped;
  // for a left page it is the other way round, and the stage is the canonical picture mirrored.
  const frontFromCanon = side === "right" ? IDENTITY : flipX;
  const backFromCanon = side === "right" ? flipX : IDENTITY;
  const stageFromCanon = side === "right" ? IDENTITY : MIRROR;
  const map = (m: Matrix) => (q: Point) => apply(m, q);

  const turned = turnedPoint(corner, w, h);
  const progress = Math.min(1, Math.max(0, 1 - length(sub(point, turned)) / (2 * w)));

  // Ends of the fold: where it crosses the page's edges (the two points shared by both parts).
  const shared = lifted.filter((q) =>
    flat.some((f) => Math.abs(f.x - q.x) + Math.abs(f.y - q.y) < 1e-6)
  );
  const ends = (shared.length >= 2 ? shared.slice(0, 2) : [middle, middle]) as [Point, Point];

  const stageNormal = side === "right" ? normal : { x: -normal.x, y: normal.y };
  return {
    front: flat.map(map(frontFromCanon)),
    backClip: lifted.map(map(backFromCanon)),
    // Back's own coordinates -> canonical front (the same flip, it is its own inverse) -> mirrored across the
    // fold -> stage.
    backMatrix: compose(stageFromCanon, compose(reflect, backFromCanon)),
    flap: lifted.map(map(compose(stageFromCanon, reflect))),
    uncovered: lifted.map(map(stageFromCanon)),
    fold: ends.map(map(stageFromCanon)) as [Point, Point],
    normal: stageNormal,
    progress,
  };
}

/** CSS `polygon(...)` for points in an element's own pixels. */
export const polygonCss = (points: Point[]): string =>
  `polygon(${points.map((q) => `${round(q.x)}px ${round(q.y)}px`).join(", ")})`;

export const matrixCss = (m: Matrix): string => `matrix(${m.map(round).join(", ")})`;

export const pointsAttr = (points: Point[]): string =>
  points.map((q) => `${round(q.x)},${round(q.y)}`).join(" ");

const round = (value: number) => Math.round(value * 100) / 100;

/** Ease-out with a slight settle, for a page finishing its turn. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Where the corner is at time t (0 to 1) of an automatic turn from `from` to `to`: along the straight line,
 * lifted into an arc so the page rises as it goes over, like a page turned by hand.
 */
export function arcPoint(from: Point, to: Point, t: number, lift: number): Point {
  const k = easeOut(t);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k - Math.sin(Math.PI * k) * lift,
  };
}
