// Small pieces for the hand-drawn SVG charts on the statistics page.

export interface XY {
  x: number;
  y: number;
}

/** A y axis in minutes: round steps, at most five of them, reaching at least `max`. */
export function minuteTicks(maxMinutes: number): number[] {
  const steps = [
    5, 10, 15, 20, 30, 60, 90, 120, 180, 240, 300, 480, 600, 900, 1200, 1800, 3000, 6000,
  ];
  const top = Math.max(maxMinutes, 1);
  const step = steps.find((s) => top / s <= 5) ?? Math.ceil(top / 5 / 6000) * 6000;
  const count = Math.max(1, Math.ceil(top / step));
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/**
 * A smooth line through the points that never swings past them (monotone cubic, Fritsch-Carlson), so a day
 * with nothing stays on the floor instead of dipping below it.
 */
export function smoothPath(points: XY[]): string {
  const n = points.length;
  if (n === 0) return "";
  const fmt = (v: number) => Math.round(v * 100) / 100;
  const first = points[0] as XY;
  if (n === 1) return `M${fmt(first.x)},${fmt(first.y)}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i] as XY;
    const b = points[i + 1] as XY;
    dx.push(b.x - a.x);
    slope.push((b.y - a.y) / (b.x - a.x));
  }
  const tangent: number[] = [slope[0] as number];
  for (let i = 1; i < n - 1; i += 1) {
    const s0 = slope[i - 1] as number;
    const s1 = slope[i] as number;
    tangent.push(
      s0 * s1 <= 0
        ? 0
        : (3 * (dx[i - 1]! + dx[i]!)) /
            ((2 * dx[i]! + dx[i - 1]!) / s0 + (dx[i]! + 2 * dx[i - 1]!) / s1)
    );
  }
  tangent.push(slope[n - 2] as number);
  let d = `M${fmt(first.x)},${fmt(first.y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i] as XY;
    const b = points[i + 1] as XY;
    const h = dx[i] as number;
    d += ` C${fmt(a.x + h / 3)},${fmt(a.y + (tangent[i] as number) * (h / 3))} ${fmt(b.x - h / 3)},${fmt(
      b.y - (tangent[i + 1] as number) * (h / 3)
    )} ${fmt(b.x)},${fmt(b.y)}`;
  }
  return d;
}

/** A point on a circle; angles in turns (0 to 1), clockwise from twelve o'clock. */
export function polar(cx: number, cy: number, r: number, turn: number): XY {
  const angle = turn * 2 * Math.PI - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** A pie slice from `from` to `to` (turns). A whole circle is drawn as two halves. */
export function slicePath(cx: number, cy: number, r: number, from: number, to: number): string {
  if (to - from >= 0.9999) {
    const top = polar(cx, cy, r, 0);
    const bottom = polar(cx, cy, r, 0.5);
    return `M${top.x},${top.y} A${r},${r} 0 1 1 ${bottom.x},${bottom.y} A${r},${r} 0 1 1 ${top.x},${top.y} Z`;
  }
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M${cx},${cy} L${a.x},${a.y} A${r},${r} 0 ${large} 1 ${b.x},${b.y} Z`;
}

/** Slice colours after the first (which is the theme colour). */
export const SLICE_COLORS = [
  "#8fd0cb",
  "#f39aa6",
  "#c9eef0",
  "#7aa9b5",
  "#f6d49b",
  "#b9a7e0",
  "#a7d49b",
  "#e7b9a0",
];
