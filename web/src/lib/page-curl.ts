// Geometry of a page being turned by its corner, like paper rather than a stiff card.
//
// Everything is worked out in "canonical" coordinates: the page lies on [0, W] x [0, H] with the spine at x = 0,
// and the free corner C (top or bottom right) is pulled to the point P. The fold is the line halfway between C
// and P, at right angles to C-P. The part of the page on C's side of the fold is lifted and laid over, mirrored
// across the fold: there the back of the page shows. A left-hand page is the same picture mirrored.
//
// Paper does not crease, it rolls: the lifted part goes round a cylinder of radius r lying on the page before it
// runs on flat. Seen from above, with s a point's distance past the line where the roll starts (the fold moved
// back by a quarter turn of the cylinder, so the corner still lands on P):
//   s <= 0           the front, lying flat;
//   0 .. pi r / 2    the front going up the near side of the roll (mostly hidden under the rest);
//   pi r / 2 .. pi r the back coming over the top, seen at r sin(s / r), so squeezed towards the outer edge;
//   s >= pi r        the back, lying flat again: the same as the page mirrored across the fold.
// The roll is drawn in a few straight slices, each squeezed by an affine map.

export interface Point {
  x: number;
  y: number;
}

export type Corner = "top" | "bottom";
export type Side = "right" | "left";

/** CSS `matrix(a, b, c, d, e, f)`: (x, y) -> (a x + c y + e, b x + d y + f). */
export type Matrix = [number, number, number, number, number, number];

/** One slice of the roll: a face of the page, clipped and squeezed into place. */
export interface Strip {
  face: "front" | "back";
  /** What to show of the face, in its own coordinates; empty when the page lies too flat for a roll. */
  clip: Point[];
  /** From the face's own coordinates to stage coordinates. */
  matrix: Matrix;
  /** Where the slice lies now, in stage coordinates. */
  area: Point[];
}

export interface Curl {
  /** The part of the front still lying flat, in the front page's own coordinates. */
  front: Point[];
  /** The part lying flat again past the roll, in the back page's own coordinates (what to show of it). */
  backClip: Point[];
  /** Places the back page: from its own coordinates to stage coordinates (spine at x = 0). */
  backMatrix: Matrix;
  /** The flat part of the back where it lies now, in stage coordinates. */
  flap: Point[];
  /** The roll, front slice first (it lies underneath), then the back's slices from the outer edge in. */
  strips: Strip[];
  /** The roll's radius; 0 when the page is folded flat. */
  radius: number;
  /** A point on the line where the roll starts, in stage coordinates. */
  roll: Point;
  /** The part of the page underneath that the lifted part uncovered (the roll included), in stage coordinates. */
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
const along = (a: Point, n: Point, k: number): Point => ({ x: a.x + n.x * k, y: a.y + n.y * k });
const negate = (a: Point): Point => ({ x: -a.x, y: -a.y });

/** How many slices the back is drawn in where it goes over the roll. */
export const ROLL_STRIPS = 4;
/** Slices overlap by this much on screen, so no hairline of what lies underneath shows between them. */
const SEAM = 1.5;

/**
 * The roll's radius: none while the corner is barely lifted or almost down (the page lies nearly flat), most
 * half way over. Never so big that the corner would still be on the roll rather than at the finger.
 */
export function rollRadius(distance: number, progress: number, w: number): number {
  const most = Math.min(48, Math.max(14, w * 0.12));
  const r = Math.min(most * Math.sin(Math.PI * progress), distance / Math.PI);
  return r < 0.5 ? 0 : r;
}

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

/**
 * Moves every point along the unit normal `n` so that its distance s past the line through `origin` becomes
 * `shift + k s`. With k = -1 and no shift it is the reflection across that line.
 */
export function squash(origin: Point, n: Point, k: number, shift: number): Matrix {
  const m = k - 1;
  const e = shift - m * dot(origin, n);
  return [1 + m * n.x * n.x, m * n.x * n.y, m * n.x * n.y, 1 + m * n.y * n.y, e * n.x, e * n.y];
}

/** The part of a convex polygon between `from` and `to` past the line through `origin` (unit normal `n`). */
const slab = (polygon: Point[], origin: Point, n: Point, from: number, to: number) =>
  clipHalfPlane(clipHalfPlane(polygon, along(origin, n, from), n), along(origin, n, to), negate(n));

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
  const folded = clipHalfPlane(page, middle, negate(normal));
  if (lifted.length < 3) return null;

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
  const r = rollRadius(distance, progress, w);
  const roll = along(middle, normal, (-Math.PI * r) / 2);
  const seam = r > 0 ? SEAM : 0;
  const reflect = squash(middle, normal, -1, 0);
  const flat = clipHalfPlane(page, roll, negate(normal));
  const back = clipHalfPlane(page, along(roll, normal, Math.PI * r - seam), normal);

  // The roll: the front going up (squeezed to the roll's width), then the back coming over in slices, each
  // mapping its stretch of s straight onto the stretch of r sin(s / r) between its ends.
  const strip = (
    face: Strip["face"],
    from: number,
    to: number,
    k: number,
    shift: number
  ): Strip => {
    const own = face === "front" ? frontFromCanon : backFromCanon;
    const squeeze = squash(roll, normal, k, shift);
    // Each slice of the back runs on under the next one, by the same amount on screen however squeezed. The
    // inside of the roll ends at its outer edge, where the back's first slice begins.
    const overlap = face === "back" ? seam / Math.max(0.2, Math.abs(k)) : 0;
    const part = r > 0 ? slab(page, roll, normal, from, to + overlap) : [];
    return {
      face,
      clip: part.map(map(own)),
      matrix: compose(stageFromCanon, compose(squeeze, own)),
      area: part.map(map(compose(stageFromCanon, squeeze))),
    };
  };
  const strips = [strip("front", 0, (Math.PI * r) / 2, 2 / Math.PI, 0)];
  for (let i = 0; i < ROLL_STRIPS; i += 1) {
    const a = Math.PI / 2 + (i * Math.PI) / 2 / ROLL_STRIPS;
    const b = a + Math.PI / 2 / ROLL_STRIPS;
    const k = (Math.sin(b) - Math.sin(a)) / (b - a);
    strips.push(strip("back", r * a, r * b, k, r * (Math.sin(a) - k * a)));
  }

  // Ends of the fold: where it crosses the page's edges (the two points shared by both parts).
  const shared = lifted.filter((q) =>
    folded.some((f) => Math.abs(f.x - q.x) + Math.abs(f.y - q.y) < 1e-6)
  );
  const ends = (shared.length >= 2 ? shared.slice(0, 2) : [middle, middle]) as [Point, Point];

  const stageNormal = side === "right" ? normal : { x: -normal.x, y: normal.y };
  return {
    front: flat.map(map(frontFromCanon)),
    backClip: back.map(map(backFromCanon)),
    // Back's own coordinates -> canonical front (the same flip, it is its own inverse) -> mirrored across the
    // fold -> stage.
    backMatrix: compose(stageFromCanon, compose(reflect, backFromCanon)),
    flap: back.map(map(compose(stageFromCanon, reflect))),
    strips,
    radius: r,
    roll: apply(stageFromCanon, roll),
    uncovered: clipHalfPlane(page, roll, normal).map(map(stageFromCanon)),
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

/**
 * Where the corner is `k` (0 to 1) of the way through an automatic turn from `from` to `to`: along the straight
 * line, lifted into an arc so the page rises as it goes over, like a page turned by hand.
 */
export function arcPoint(from: Point, to: Point, k: number, lift: number): Point {
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k - Math.sin(Math.PI * k) * lift,
  };
}
