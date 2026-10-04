import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  canTurn,
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
} from "../lib/page-curl";

/** How far a finger must move before it counts as turning a page rather than a tap. */
const DRAG_START_PX = 8;
const TAP_MS = 450;
/** Near the corner, a mouse lifts it a little, to show the page can be turned. */
const PEEK_PX = 64;

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
  velocity: number;
  /** Set once the finger has moved far enough sideways. */
  turn: Turn | null;
  /** The turn's point when the drag took it over. */
  base: Turn | null;
  /** The finger went up or down first: the page is being scrolled, not turned. */
  scrolling: boolean;
}

/**
 * Light on a turning page, drawn over the stage: the shadow the lifted part casts on the page it uncovers
 * ("under"), or the shine and shade along its own fold ("flap").
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
  layer: "under" | "flap";
}) {
  const id = useId().replace(/:/g, "");
  const middle = { x: (c.fold[0].x + c.fold[1].x) / 2, y: (c.fold[0].y + c.fold[1].y) / 2 };
  const reach = Math.max(1, Math.hypot(point.x - middle.x, point.y - middle.y));
  const fall = Math.min(w * 0.5, Math.max(18, reach * 0.7));
  const strength = Math.min(1, reach / 30) * (1 - c.progress * 0.55);
  const n = c.normal;
  return (
    <svg
      className="pointer-events-none absolute top-0 overflow-visible"
      style={{ left: -w }}
      width={2 * w}
      height={h}
      viewBox={`${-w} 0 ${2 * w} ${h}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-under`}
          gradientUnits="userSpaceOnUse"
          x1={middle.x}
          y1={middle.y}
          x2={middle.x + n.x * fall}
          y2={middle.y + n.y * fall}
        >
          <stop offset="0" stopColor="#000" stopOpacity={0.42 * strength} />
          <stop offset="0.35" stopColor="#000" stopOpacity={0.12 * strength} />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id={`${id}-flap`}
          gradientUnits="userSpaceOnUse"
          x1={middle.x}
          y1={middle.y}
          x2={middle.x - n.x * reach}
          y2={middle.y - n.y * reach}
        >
          <stop offset="0" stopColor="#000" stopOpacity="0.16" />
          <stop offset="0.05" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0.03" />
          <stop offset="1" stopColor="#000" stopOpacity="0.09" />
        </linearGradient>
      </defs>
      {layer === "under" ? (
        <polygon points={pointsAttr(c.uncovered)} fill={`url(#${id}-under)`} />
      ) : (
        <polygon points={pointsAttr(c.flap)} fill={`url(#${id}-flap)`} />
      )}
    </svg>
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
  const [peek, setPeek] = useState(false);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const live = useRef({ position, turn, pages, layout });
  useLayoutEffect(() => {
    live.current = { position, turn, pages, layout };
  });

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const animating = () => frame.current !== null;

  /** Lets the page fall the rest of the way, along an arc when it goes over. */
  const finish = (from: Turn, end: "turned" | "flat") => {
    const target =
      end === "turned" ? turnedPoint(from.corner, w, h) : cornerPoint(from.corner, w, h);
    const done = () => {
      frame.current = null;
      setTurn(null);
      setPeek(false);
      onPosition(endTurn(from, end));
    };
    const distance = Math.hypot(target.x - from.point.x, target.y - from.point.y);
    if (reducedMotion || distance < 1) return done();
    const crossing = Math.abs(target.x - from.point.x) > w * 0.6;
    const lift = crossing ? h * 0.1 * (from.corner === "bottom" ? 1 : -1) : 0;
    const duration = Math.min(720, 240 + (distance / (2 * w)) * 520);
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const point = clampPoint(arcPoint(from.point, target, t, lift), from.corner, w, h);
      setTurn({ ...from, point });
      if (t < 1) frame.current = requestAnimationFrame(step);
      else done();
    };
    frame.current = requestAnimationFrame(step);
  };

  /** A page turned all the way by a tap, a key or the wheel. */
  const turnPage = (direction: Direction) => {
    const { position: at, pages: count, layout: shape } = live.current;
    if (animating() || drag.current?.turn || !canTurn(shape, count, at, direction)) return;
    const start = startTurn(shape, at, direction, "bottom", w, h);
    // Start just off the corner so the page lifts at once.
    const nudge = start.reverse ? { x: 12, y: -10 } : { x: -12, y: -10 };
    const lifted = {
      ...start,
      point: clampPoint({ x: start.point.x + nudge.x, y: start.point.y + nudge.y }, "bottom", w, h),
    };
    finish(lifted, start.reverse ? "flat" : "turned");
  };

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
    if (animating() || event.button > 0) return;
    const p = toStage(event);
    const now = performance.now();
    drag.current = {
      id: event.pointerId,
      start: p,
      last: p,
      lastTime: now,
      startTime: event.timeStamp,
      velocity: 0,
      turn: null,
      base: peek && turn ? turn : null,
      scrolling: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const p = toStage(event);
    const d = drag.current;
    if (!d) {
      // A mouse resting near the bottom corner lifts it a little.
      if (event.pointerType !== "mouse" || animating()) return;
      const corner = cornerPoint("bottom", w, h);
      const near = Math.hypot(p.x - corner.x, p.y - corner.y) < PEEK_PX && p.x <= w && p.y <= h;
      if (near && canTurn(layout, pages, position, "next")) {
        const pull = {
          x: corner.x + (p.x - corner.x) * 0.6 - 10,
          y: corner.y + (p.y - corner.y) * 0.6 - 8,
        };
        setTurn({
          ...startTurn(layout, position, "next", "bottom", w, h),
          point: clampPoint(pull, "bottom", w, h),
        });
        setPeek(true);
      } else if (peek) {
        setTurn(null);
        setPeek(false);
      }
      return;
    }
    if (d.id !== event.pointerId || d.scrolling) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastTime);
    d.velocity = 0.6 * ((p.x - d.last.x) / dt) + 0.4 * d.velocity;
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
      setPeek(false);
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }
    setTurn({
      ...d.turn,
      point: dragPoint(d.turn, { x: p.x - d.start.x, y: p.y - d.start.y }, w, h),
    });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== event.pointerId) return;
    if (d.turn) {
      const current = live.current.turn ?? d.turn;
      const progress = curl(current.point, current.corner, current.side, w, h)?.progress ?? 0;
      finish(current, settle(current, progress, d.velocity));
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
    const current = live.current.turn;
    if (d?.turn && current) finish(current, current.reverse ? "turned" : "flat");
  };

  const tap = (p: Point) => {
    const shown = pagesAt(layout, pages, position);
    if (p.x >= 0) {
      const at = p.x / w;
      if (at > 0.8) return turnPage("next");
      if (at < 0.2 && layout === "single") return turnPage("prev");
      const index = layout === "single" ? position : position * 2;
      if (index < pages && p.x <= w) onTapPage(index);
      return;
    }
    if (layout === "single" || -p.x / w > 0.8) return turnPage("prev");
    const left = shown.find((index) => index === position * 2 - 1);
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
  const pageBox = (left: number) =>
    ({ position: "absolute", left, top: 0, width: w, height: h }) as const;

  return (
    <div
      ref={element}
      className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (peek && !drag.current) {
          setTurn(null);
          setPeek(false);
        }
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
      <div
        className="absolute"
        style={{ left: geometry.x, top: geometry.y, width: 0, height: h, perspective: 2400 }}
      >
        {under}
        <Edge leaves={faces.leftLeaves} side="left" w={w} h={h} />
        <Edge leaves={faces.rightLeaves} side="right" w={w} h={h} />
        <div className="book-left" style={pageBox(-w)} data-face="left">
          {renderFace(faces.left, "left")}
        </div>
        <div
          key={reducedMotion ? `right-${position}` : "right"}
          className={reducedMotion ? "fade-in" : undefined}
          style={pageBox(0)}
          data-face="right"
        >
          {renderFace(faces.right, "right")}
        </div>
        {turn && faces.front && !c && (
          <div style={pageBox(frontLeft)}>{renderFace(faces.front, turn.side)}</div>
        )}
        {turn && faces.front && faces.back && c && pointOnStage && (
          <>
            <div style={{ ...pageBox(frontLeft), clipPath: polygonCss(c.front) }} data-face="front">
              {renderFace(faces.front, turn.side)}
            </div>
            <Shading c={c} w={w} h={h} point={pointOnStage} layer="under" />
            <div
              className="pointer-events-none absolute top-0 left-0"
              style={{
                filter: `drop-shadow(0 2px ${4 + 10 * Math.sin(Math.PI * c.progress)}px rgba(0,0,0,0.22))`,
              }}
            >
              <div
                style={{
                  ...pageBox(0),
                  transformOrigin: "0 0",
                  transform: matrixCss(c.backMatrix),
                  clipPath: polygonCss(c.backClip),
                }}
                data-face="back"
              >
                {renderFace(faces.back, turn.side === "right" ? "left" : "right")}
              </div>
            </div>
            <Shading c={c} w={w} h={h} point={pointOnStage} layer="flap" />
          </>
        )}
        {over}
      </div>
    </div>
  );
}
