import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  canTurn,
  cornerDelta,
  dragPoint,
  endTurn,
  facesAt,
  pagesAt,
  settle,
  startTurn,
  type Direction,
  type Face,
  type Layout,
  type Turn,
} from "../lib/book";
import {
  arcPoint,
  clampPoint,
  cornerPoint,
  curl,
  matrixCss,
  pointsAttr,
  polygonCss,
  turnedPoint,
  type Curl,
  type Point,
  type Strip,
} from "../lib/page-curl";

/** How far a finger must move before it counts as turning a page rather than a tap. */
const DRAG_START_PX = 8;
const TAP_MS = 450;
/** Near the corner, a mouse lifts it a little, to show the page can be turned. */
const PEEK_PX = 64;
/** The spring that carries a page the rest of the way once let go (1/s); quicker in a run of turns. */
const SPRING = 12;
const SPRING_QUICK = 18;
/** However it was let go, a page has settled by then. */
const SETTLE_MS = 900;
/** A lifted corner follows the mouse this lazily (ms, time constant). */
const FOLLOW_MS = 60;
/** A finger held still this long before letting go has no speed left to give the page. */
const STILL_MS = 80;

export interface StageGeometry {
  /** One page's size. */
  w: number;
  h: number;
  /** The spine's place in the stage element. */
  x: number;
  y: number;
}

interface Drag {
  id: number;
  start: Point;
  last: Point;
  lastTime: number;
  startTime: number;
  /** The finger's speed, in stage pixels per ms, smoothed. */
  velocity: Point;
  /** Set once the finger has moved far enough sideways, or at once when it caught a turning page. */
  turn: Turn | null;
  /** The turn's point when the drag took it over. */
  base: Turn | null;
  /** The finger went up or down first: the page is being scrolled, not turned. */
  scrolling: boolean;
}

/** The finger's speed as it lets go: none if it had stopped first. */
const letGoSpeed = (d: Drag): Point =>
  performance.now() - d.lastTime > STILL_MS ? { x: 0, y: 0 } : d.velocity;

/** What is moving the page without a finger on it: a turn finishing, or a corner following the mouse. */
type Motion = { kind: "finish"; from: Turn } | { kind: "follow"; target: Point; flat: boolean };

const sameFace = (a: Face, b: Face) =>
  a.type === b.type &&
  (a.type !== "page" || a.index === (b as typeof a).index) &&
  (a.type !== "blank" || a.ghost === (b as typeof a).ghost);

/** A face's contents, drawn again only when it shows something else: a turn moves only what holds it. */
const FaceView = memo(
  function FaceView({
    face,
    side,
    render,
  }: {
    face: Face;
    side: "left" | "right";
    render: (face: Face, side: "left" | "right") => ReactNode;
  }) {
    return render(face, side);
  },
  (a, b) => a.side === b.side && a.render === b.render && sameFace(a.face, b.face)
);

/**
 * A face's contents on a layer of their own while the page turns, so they are drawn once and each frame only
 * moves and cuts that picture. The cut has to be on the element around it: a clip on the layer itself would
 * have the contents drawn again whenever it changes, that is every frame.
 */
function Layer({ children }: { children: ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, willChange: "transform" }}>{children}</div>;
}

/** Angles round the roll, from its top (where the back lies flat again) to its outer edge. */
const ROLL_STOPS = Array.from({ length: 9 }, (_, i) => Math.PI - (i * Math.PI) / 16);
/** Across the inside of the roll, from where it leaves the page to its outer edge (0 to 1). */
const INSIDE_STOPS = [0, 0.5, 0.75, 0.9, 1];
/** The soft shadow is drawn at this fraction of the page's size and stretched back up. */
const SHADOW_SCALE = 0.25;
/** Room round the pages for the soft shadow to spread into (px). */
const SHADOW_MARGIN = 24;

/**
 * The soft shadow the lifted part casts, just round its edges. It is blurred on a small canvas and stretched to
 * size: an SVG or CSS blur would be worked out afresh at full size on every frame of a turn.
 */
function SoftShadow({ c, w, h }: { c: Curl; w: number; h: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = Math.ceil((2 * w + 2 * SHADOW_MARGIN) * SHADOW_SCALE);
  const height = Math.ceil((h + 2 * SHADOW_MARGIN) * SHADOW_SCALE);
  const lift = Math.sin(Math.PI * c.progress);
  useLayoutEffect(() => {
    if (typeof CanvasRenderingContext2D === "undefined") return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const blur = 1.5 + c.radius * 0.12 + 4 * lift;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    // Only the shadow is wanted: the shape itself goes well off the canvas and its shadow is thrown back.
    const away = 2 * width;
    context.setTransform(
      SHADOW_SCALE,
      0,
      0,
      SHADOW_SCALE,
      (w + SHADOW_MARGIN) * SHADOW_SCALE - away,
      (SHADOW_MARGIN + 1 + c.radius * 0.1 + 2 * lift) * SHADOW_SCALE
    );
    context.shadowOffsetX = away;
    context.shadowBlur = 2 * blur * SHADOW_SCALE;
    // Solid here, faded as a whole below, so where the parts overlap it is no darker.
    context.shadowColor = "#000";
    for (const area of [c.flap, ...c.strips.filter((s) => s.face === "back").map((s) => s.area)]) {
      context.beginPath();
      area.forEach((q, i) => (i === 0 ? context.moveTo(q.x, q.y) : context.lineTo(q.x, q.y)));
      context.fill();
    }
  });
  return (
    <canvas
      ref={canvas}
      className="pointer-events-none absolute"
      width={width}
      height={height}
      style={{
        left: -w - SHADOW_MARGIN,
        top: -SHADOW_MARGIN,
        width: width / SHADOW_SCALE,
        height: height / SHADOW_SCALE,
        opacity: 0.2 + 0.1 * lift,
      }}
      aria-hidden="true"
    />
  );
}

/** Gradient stops along the roll, from where it starts to its outer edge. */
const stops = (color: string, list: { offset: number; opacity: number }[]) =>
  list.map(({ offset, opacity }, i) => (
    <stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />
  ));

/**
 * Light on a turning page, drawn over the stage in three layers. "under": the shadow the lifted part casts on
 * the pages below it. "inside": the inside of the roll, where it shows past the page's edges, bright where it
 * leaves the page and in shade towards the top. "over": the back going over the roll, lit like a cylinder (dark
 * towards the outer edge, a shine near the top), and the flat part of the back past it.
 */
function Shading({
  c,
  w,
  h,
  point,
  layer,
}: {
  c: Curl;
  w: number;
  h: number;
  point: Point;
  layer: "under" | "inside" | "over";
}) {
  const id = useId().replace(/:/g, "");
  const n = c.normal;
  const r = c.radius;
  const middle = { x: (c.fold[0].x + c.fold[1].x) / 2, y: (c.fold[0].y + c.fold[1].y) / 2 };
  const reach = Math.max(1, Math.hypot(point.x - middle.x, point.y - middle.y));
  // The roll's outer edge, where the page underneath starts to show.
  const edge = { x: c.roll.x + n.x * r, y: c.roll.y + n.y * r };
  const across = { x1: c.roll.x, y1: c.roll.y, x2: edge.x, y2: edge.y };
  const parts = (face: "front" | "back") =>
    c.strips.filter((s) => s.face === face && s.area.length >= 3);
  const back = parts("back");
  /** Fills the given parts of the roll as one shape, so slices overlapping at their seams show no lines. */
  const fill = (key: string, list: typeof back, paint: string) => (
    <>
      <clipPath id={`${id}-${key}-clip`}>
        {list.map((s, i) => (
          <polygon key={i} points={pointsAttr(s.area)} />
        ))}
      </clipPath>
      <rect
        x={-2 * w}
        y={-h}
        width={4 * w}
        height={3 * h}
        clipPath={`url(#${id}-${key}-clip)`}
        fill={paint}
      />
    </>
  );

  let content: ReactNode;
  if (layer === "under") {
    const fall = Math.min(w * 0.5, Math.max(18, reach * 0.7)) + r;
    const strength = Math.min(1, reach / 30) * (1 - c.progress * 0.55);
    content = (
      <>
        <defs>
          <linearGradient
            id={`${id}-under`}
            gradientUnits="userSpaceOnUse"
            x1={edge.x}
            y1={edge.y}
            x2={edge.x + n.x * fall}
            y2={edge.y + n.y * fall}
          >
            <stop offset="0" stopColor="#000" stopOpacity={0.42 * strength} />
            <stop offset="0.35" stopColor="#000" stopOpacity={0.12 * strength} />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={pointsAttr(c.uncovered)} fill={`url(#${id}-under)`} />
      </>
    );
  } else if (layer === "inside") {
    content = r > 0 && (
      <>
        <linearGradient id={`${id}-inside`} gradientUnits="userSpaceOnUse" {...across}>
          {stops(
            "#000",
            INSIDE_STOPS.map((o) => ({
              offset: o,
              opacity: 0.05 + 0.3 * (1 - Math.sqrt(1 - o * o)),
            }))
          )}
        </linearGradient>
        {fill("inside", parts("front"), `url(#${id}-inside)`)}
      </>
    );
  } else {
    // Folded flat (no roll yet, or none left) the fold is a crease: a dark line and a shine just past it.
    const crease = 1 - Math.min(1, r / 8);
    content = (
      <>
        <linearGradient
          id={`${id}-flap`}
          gradientUnits="userSpaceOnUse"
          x1={c.roll.x}
          y1={c.roll.y}
          x2={c.roll.x - n.x * reach}
          y2={c.roll.y - n.y * reach}
        >
          <stop offset="0" stopColor="#000" stopOpacity={0.16 * crease} />
          <stop offset="0.05" stopColor="#fff" stopOpacity={0.3 * crease} />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0.03" />
          <stop offset="1" stopColor="#000" stopOpacity="0.09" />
        </linearGradient>
        <polygon points={pointsAttr(c.flap)} fill={`url(#${id}-flap)`} />
        {r > 0 && (
          <>
            <linearGradient id={`${id}-shade`} gradientUnits="userSpaceOnUse" {...across}>
              {stops("#000", [
                ...ROLL_STOPS.map((a) => ({
                  offset: Math.sin(a),
                  opacity: 0.34 * (1 + Math.cos(a)) ** 1.1,
                })),
                { offset: 1, opacity: 0.42 },
              ])}
            </linearGradient>
            <linearGradient id={`${id}-shine`} gradientUnits="userSpaceOnUse" {...across}>
              {stops(
                "#fff",
                ROLL_STOPS.map((a) => ({
                  offset: Math.sin(a),
                  opacity: 0.45 * Math.exp(-(((a / Math.PI - 0.8) / 0.08) ** 2)),
                }))
              )}
            </linearGradient>
            {fill("shade", back, `url(#${id}-shade)`)}
            {fill("shine", back, `url(#${id}-shine)`)}
          </>
        )}
      </>
    );
  }
  const picture = (
    <svg
      className="pointer-events-none absolute top-0 overflow-visible"
      style={{ left: -w }}
      width={2 * w}
      height={h}
      viewBox={`${-w} 0 ${2 * w} ${h}`}
      aria-hidden="true"
    >
      {content}
    </svg>
  );
  return layer === "under" ? (
    <>
      {picture}
      <SoftShadow c={c} w={w} h={h} />
    </>
  ) : (
    picture
  );
}

/** The paper thickness showing at the outer edge of a pile of leaves. */
function Edge({
  leaves,
  side,
  w,
  h,
}: {
  leaves: number;
  side: "left" | "right";
  w: number;
  h: number;
}) {
  const width = Math.min(7, Math.ceil(leaves / 3));
  if (width <= 0) return null;
  return (
    <div
      className={`book-edge pointer-events-none absolute ${side === "left" ? "book-left" : ""}`}
      style={{
        top: 3,
        height: h - 6,
        width,
        left: side === "right" ? w : -w - width,
        borderRadius: side === "right" ? "0 3px 3px 0" : "3px 0 0 3px",
      }}
    />
  );
}

export function BookStage({
  layout,
  pages,
  position,
  geometry,
  reducedMotion,
  renderFace,
  onPosition,
  onTapPage,
  under,
  over,
}: {
  layout: Layout;
  /** How many pages there are. */
  pages: number;
  position: number;
  geometry: StageGeometry;
  reducedMotion: boolean;
  renderFace: (face: Face, side: "left" | "right") => ReactNode;
  onPosition: (position: number) => void;
  /** A tap in the middle of a page. */
  onTapPage: (index: number) => void;
  /** Drawn on the stage under the pages (the case) and over them (the cover). */
  under?: ReactNode;
  over?: ReactNode;
}) {
  const { w, h } = geometry;
  const [turn, setTurn] = useState<Turn | null>(null);
  /** The turn on show, for handlers that run before React has drawn it. */
  const shown = useRef<Turn | null>(null);
  /** The corner is lifted under a resting mouse. */
  const peeking = useRef(false);
  /** A turn asked for while another was still going: done next. */
  const queued = useRef<Direction | null>(null);
  const motion = useRef<Motion | null>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const live = useRef({ position, pages, layout });
  useLayoutEffect(() => {
    live.current = { position, pages, layout };
  });

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const show = (next: Turn | null) => {
    shown.current = next;
    setTurn(next);
  };

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    motion.current = null;
  };

  const turning = () => motion.current?.kind === "finish";

  /**
   * Lets the page go the rest of the way, on a spring that starts at the finger's speed (stage pixels per ms),
   * along an arc when it goes over.
   */
  const finish = (
    from: Turn,
    end: "turned" | "flat",
    velocity: Point = { x: 0, y: 0 },
    quick = false
  ) => {
    stop();
    peeking.current = false;
    const target =
      end === "turned" ? turnedPoint(from.corner, w, h) : cornerPoint(from.corner, w, h);
    const done = () => {
      stop();
      show(null);
      onPosition(endTurn(from, end));
    };
    const path = { x: target.x - from.point.x, y: target.y - from.point.y };
    const distance = Math.hypot(path.x, path.y);
    if (reducedMotion || distance < 1) return done();
    const crossing = Math.abs(path.x) > w * 0.6;
    const lift = crossing ? h * 0.1 * (from.corner === "bottom" ? 1 : -1) : 0;
    const spring = quick ? SPRING_QUICK : SPRING;
    // The finger's speed along the way the corner has to go, in whole journeys per second.
    const v = cornerDelta(from, velocity);
    const speed = Math.min(
      4 * spring,
      Math.max(0, (((v.x * path.x + v.y * path.y) / distance) * 1000) / distance)
    );
    const startedAt = performance.now();
    motion.current = { kind: "finish", from };
    const step = (now: number) => {
      const t = Math.max(0, now - startedAt) / 1000;
      // A critically damped spring from 0 to 1: how much of the way is still to go.
      const left = (1 + (spring - speed) * t) * Math.exp(-spring * t);
      if (now - startedAt >= SETTLE_MS || left * distance < 0.5) return done();
      const point = clampPoint(arcPoint(from.point, target, 1 - left, lift), from.corner, w, h);
      show({ ...from, point });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  /** Moves a lifted corner smoothly to `target`; `flat` lays it down and lets go of it there. */
  const follow = (target: Point, flat: boolean) => {
    if (turning()) return;
    const running = motion.current?.kind === "follow";
    motion.current = { kind: "follow", target, flat };
    if (running) return;
    let last = performance.now();
    const step = (now: number) => {
      frame.current = null;
      const m = motion.current;
      const current = shown.current;
      if (m?.kind !== "follow" || !current) return;
      const k = 1 - Math.exp(-Math.max(0, now - last) / FOLLOW_MS);
      last = now;
      const d = { x: m.target.x - current.point.x, y: m.target.y - current.point.y };
      const arrived = Math.hypot(d.x, d.y) * (1 - k) < 0.3;
      if (arrived) {
        motion.current = null;
        if (m.flat) {
          peeking.current = false;
          return show(null);
        }
        return show({ ...current, point: m.target });
      }
      show({ ...current, point: { x: current.point.x + d.x * k, y: current.point.y + d.y * k } });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  /** A page turned all the way by a tap, a key or the wheel; one asked for during a turn waits for it. */
  const turnPage = (direction: Direction, quick = false) => {
    const { position: at, pages: count, layout: shape } = live.current;
    if (drag.current?.turn) return;
    if (turning()) {
      queued.current = direction;
      return;
    }
    if (!canTurn(shape, count, at, direction)) return;
    const start = startTurn(shape, at, direction, "bottom", w, h);
    // A corner already lifted under the mouse goes on from there; otherwise start just off the corner so the
    // page lifts at once.
    const lifted = peeking.current && direction === "next" ? shown.current : null;
    const nudge = start.reverse ? { x: 12, y: -10 } : { x: -12, y: -10 };
    const from = lifted ?? {
      ...start,
      point: clampPoint({ x: start.point.x + nudge.x, y: start.point.y + nudge.y }, "bottom", w, h),
    };
    finish(from, start.reverse ? "flat" : "turned", { x: 0, y: 0 }, quick);
  };

  // Once a turn is over, the one asked for meanwhile.
  useEffect(() => {
    if (turn || motion.current || !queued.current) return;
    const next = queued.current;
    queued.current = null;
    turnPage(next, true);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [role=dialog]")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") turnPage("next");
      if (event.key === "ArrowLeft" || event.key === "PageUp") turnPage("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const wheelAt = useRef(0);

  const toStage = (event: { clientX: number; clientY: number }): Point => {
    const rect = element.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0) - geometry.x,
      y: event.clientY - (rect?.top ?? 0) - geometry.y,
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button > 0) return;
    const p = toStage(event);
    const now = performance.now();
    const m = motion.current;
    // A page still turning is caught where it is, and the finger carries on with it.
    const caught = m?.kind === "finish" ? (shown.current ?? m.from) : null;
    if (m) stop();
    if (caught) {
      queued.current = null;
      show(caught);
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }
    drag.current = {
      id: event.pointerId,
      start: p,
      last: p,
      lastTime: now,
      startTime: event.timeStamp,
      velocity: { x: 0, y: 0 },
      turn: caught,
      base: !caught && peeking.current ? shown.current : null,
      scrolling: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const p = toStage(event);
    const d = drag.current;
    if (!d) {
      // A mouse resting near the bottom corner lifts it a little.
      if (event.pointerType !== "mouse" || turning()) return;
      const corner = cornerPoint("bottom", w, h);
      const near = Math.hypot(p.x - corner.x, p.y - corner.y) < PEEK_PX && p.x <= w && p.y <= h;
      if (near && canTurn(layout, pages, position, "next")) {
        const pull = {
          x: corner.x + (p.x - corner.x) * 0.6 - 10,
          y: corner.y + (p.y - corner.y) * 0.6 - 8,
        };
        if (!peeking.current) show(startTurn(layout, position, "next", "bottom", w, h));
        peeking.current = true;
        follow(clampPoint(pull, "bottom", w, h), false);
      } else if (peeking.current) {
        follow(corner, true);
      }
      return;
    }
    if (d.id !== event.pointerId || d.scrolling) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastTime);
    d.velocity = {
      x: 0.6 * ((p.x - d.last.x) / dt) + 0.4 * d.velocity.x,
      y: 0.6 * ((p.y - d.last.y) / dt) + 0.4 * d.velocity.y,
    };
    d.last = p;
    d.lastTime = now;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.turn) {
      // Lifting a corner is often a diagonal pull; only a clearly vertical one is not a turn.
      if (Math.abs(dy) > DRAG_START_PX && Math.abs(dy) > 2 * Math.abs(dx)) {
        d.scrolling = true;
        return;
      }
      if (Math.abs(dx) < DRAG_START_PX) return;
      const direction: Direction = dx < 0 ? "next" : "prev";
      if (!canTurn(layout, pages, position, direction)) return;
      const corner = d.start.y < h / 2 ? "top" : "bottom";
      d.turn =
        d.base && direction === "next"
          ? d.base
          : startTurn(layout, position, direction, corner, w, h);
      d.start = p;
      peeking.current = false;
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }
    show({
      ...d.turn,
      point: dragPoint(d.turn, { x: p.x - d.start.x, y: p.y - d.start.y }, w, h),
    });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== event.pointerId) return;
    if (d.turn) {
      const current = shown.current ?? d.turn;
      const progress = curl(current.point, current.corner, current.side, w, h)?.progress ?? 0;
      const velocity = letGoSpeed(d);
      finish(current, settle(current, progress, velocity.x), velocity);
      return;
    }
    const p = toStage(event);
    const moved = Math.hypot(p.x - d.start.x, p.y - d.start.y);
    if (d.scrolling || moved > DRAG_START_PX || event.timeStamp - d.startTime > TAP_MS) return;
    tap(p);
  };

  const onPointerCancel = () => {
    const d = drag.current;
    drag.current = null;
    const current = shown.current;
    if (d?.turn && current) finish(current, current.reverse ? "turned" : "flat");
  };

  const tap = (p: Point) => {
    const shownPages = pagesAt(layout, pages, position);
    if (p.x >= 0) {
      const at = p.x / w;
      if (at > 0.8) return turnPage("next");
      if (at < 0.2 && layout === "single") return turnPage("prev");
      const index = layout === "single" ? position : position * 2;
      if (index < pages && p.x <= w) onTapPage(index);
      return;
    }
    if (layout === "single" || -p.x / w > 0.8) return turnPage("prev");
    const left = shownPages.find((index) => index === position * 2 - 1);
    if (left !== undefined) onTapPage(left);
  };

  const faces = facesAt(layout, pages, position, turn);
  const c = turn ? curl(turn.point, turn.corner, turn.side, w, h) : null;
  const pointOnStage = turn
    ? turn.side === "right"
      ? turn.point
      : { x: -turn.point.x, y: turn.point.y }
    : null;
  const frontLeft = turn?.side === "left" ? -w : 0;
  const backSide = turn?.side === "right" ? "left" : "right";
  const { front, back } = faces;
  const pageBox = (left: number) =>
    ({
      position: "absolute",
      left,
      top: 0,
      width: w,
      height: h,
      contain: "layout paint size",
    }) as const;
  /** A face placed by a matrix from its own coordinates and cut to what shows of it. */
  const placed = (matrix: string, clip: string | undefined) =>
    ({
      ...pageBox(0),
      transformOrigin: "0 0",
      transform: matrix,
      clipPath: clip,
      visibility: clip ? undefined : "hidden",
    }) as const;

  /** One slice of the roll. */
  const roll = (strip: Strip, i: number) =>
    turn &&
    front &&
    back && (
      <div
        key={i}
        className="pointer-events-none"
        style={placed(
          matrixCss(strip.matrix),
          strip.clip.length >= 3 ? polygonCss(strip.clip) : undefined
        )}
        data-face="roll"
      >
        <Layer>
          <FaceView
            face={strip.face === "front" ? front : back}
            side={strip.face === "front" ? turn.side : backSide}
            render={renderFace}
          />
        </Layer>
      </div>
    );

  return (
    <div
      ref={element}
      className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (peeking.current && !drag.current) follow(cornerPoint("bottom", w, h), true);
      }}
      onWheel={(event) => {
        const now = performance.now();
        if (now - wheelAt.current < 500) return;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (Math.abs(delta) < 24) return;
        wheelAt.current = now;
        turnPage(delta > 0 ? "next" : "prev");
      }}
      data-testid="book-stage"
    >
      <div className="absolute" style={{ left: geometry.x, top: geometry.y, width: 0, height: h }}>
        {under}
        <Edge leaves={faces.leftLeaves} side="left" w={w} h={h} />
        <Edge leaves={faces.rightLeaves} side="right" w={w} h={h} />
        <div className="book-left" style={pageBox(-w)} data-face="left">
          <FaceView face={faces.left} side="left" render={renderFace} />
        </div>
        <div
          key={reducedMotion ? `right-${position}` : "right"}
          className={reducedMotion ? "fade-in" : undefined}
          style={pageBox(0)}
          data-face="right"
        >
          <FaceView face={faces.right} side="right" render={renderFace} />
        </div>
        {turn && front && (
          <div
            style={{ ...pageBox(frontLeft), clipPath: c ? polygonCss(c.front) : undefined }}
            data-face={c ? "front" : undefined}
          >
            <Layer>
              <FaceView face={front} side={turn.side} render={renderFace} />
            </Layer>
          </div>
        )}
        {turn && front && back && c && pointOnStage && (
          <>
            <Shading c={c} w={w} h={h} point={pointOnStage} layer="under" />
            {c.strips.slice(0, 1).map(roll)}
            <Shading c={c} w={w} h={h} point={pointOnStage} layer="inside" />
            {c.strips.slice(1).map(roll)}
            <div
              className="pointer-events-none"
              style={placed(matrixCss(c.backMatrix), polygonCss(c.backClip))}
              data-face="back"
            >
              <Layer>
                <FaceView face={back} side={backSide} render={renderFace} />
              </Layer>
            </div>
            <Shading c={c} w={w} h={h} point={pointOnStage} layer="over" />
          </>
        )}
        {over}
      </div>
    </div>
  );
}
