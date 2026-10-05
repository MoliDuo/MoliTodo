// Long press a line, then drag it to another place in the day's list. Rows are measured once when the drag starts;
// while it goes on, the other rows slide aside to show the gap, and on release the line moves for real.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export const LONG_PRESS_MS = 450;
/** A finger that moves this far before the long press is scrolling, not pressing. */
const SLOP_PX = 8;
/** Closer than this to the top or bottom of the screen, the page scrolls along. */
const EDGE_PX = 64;
const SCROLL_STEP_PX = 10;

/** Where a dragged row whose middle is at `y` goes among the other rows, given their middles in order. */
export const dropIndex = (middles: number[], y: number): number =>
  middles.filter((middle) => middle < y).length;

/** How far a row moves aside while another is dragged from `from` to the gap at `to` (among the others). */
export function shiftOf(index: number, from: number, to: number, height: number): number {
  if (index === from) return 0;
  const other = index < from ? index : index - 1;
  if (index > from && other < to) return -height;
  if (index < from && other >= to) return height;
  return 0;
}

interface Press {
  id: string;
  pointer: number;
  x: number;
  y: number;
  timer?: ReturnType<typeof setTimeout>;
  element: HTMLElement;
}

/** A drag in progress, with what was measured when it began. */
interface Live {
  state: DragState;
  /** Middle of each row, in page coordinates (scroll included), and the dragged row's own. */
  middles: number[];
  middle: number;
  /** Where the pointer started, in page coordinates. */
  startY: number;
}

export interface DragState {
  id: string;
  from: number;
  /** Gap among the other rows where it would land. */
  to: number;
  /** How far the dragged row has moved. */
  dy: number;
  height: number;
}

export interface ReorderOptions {
  ids: string[];
  /** Finds the row elements, in list order (the dragged one included). */
  rows: () => HTMLElement[];
  /** Moves `id` before `beforeId` (null: to the end). */
  onMove: (id: string, beforeId: string | null) => void;
}

/**
 * Pointer handlers for each row and the drag in progress. A press on a textarea that is being edited is left to
 * the browser (selecting text); anywhere else a long press picks the row up.
 */
export function useReorder({ ids, rows, onMove }: ReorderOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const press = useRef<Press | null>(null);
  const live = useRef<Live | null>(null);
  const lastY = useRef(0);
  const frame = useRef<number | null>(null);
  /** Set after a drop so the click that follows does not tick a box or start editing. */
  const swallowClick = useRef(false);
  const latest = useRef({ ids, rows, onMove });
  useEffect(() => {
    latest.current = { ids, rows, onMove };
  });

  const cancelPress = () => {
    clearTimeout(press.current?.timer);
    press.current = null;
  };

  const follow = (clientY: number) => {
    const current = live.current;
    if (!current) return;
    lastY.current = clientY;
    const dy = clientY + window.scrollY - current.startY;
    const state = { ...current.state, dy, to: dropIndex(current.middles, current.middle + dy) };
    live.current = { ...current, state };
    setDrag(state);
  };

  const autoScroll = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    const y = lastY.current;
    const step = y < EDGE_PX ? -SCROLL_STEP_PX : y > height - EDGE_PX ? SCROLL_STEP_PX : 0;
    if (step !== 0) {
      window.scrollBy(0, step);
      follow(y);
    }
    frame.current = requestAnimationFrame(autoScroll);
  };

  const begin = (start: Press) => {
    press.current = null;
    const from = latest.current.ids.indexOf(start.id);
    if (from < 0) return;
    const middles = latest.current.rows().map((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top + window.scrollY + rect.height / 2;
    });
    try {
      start.element.setPointerCapture(start.pointer);
    } catch {
      // Not every pointer can be captured (and tests have none); moves still reach the row.
    }
    navigator.vibrate?.(10);
    lastY.current = start.y;
    const state = {
      id: start.id,
      from,
      to: from,
      dy: 0,
      height: start.element.getBoundingClientRect().height,
    };
    live.current = {
      state,
      middle: middles[from] as number,
      middles: middles.filter((_, i) => i !== from),
      startY: start.y + window.scrollY,
    };
    setDrag(state);
    frame.current = requestAnimationFrame(autoScroll);
  };

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    cancelPress();
    const current = live.current?.state;
    live.current = null;
    setDrag(null);
    return current;
  };

  const finish = (commit: boolean) => {
    const current = stop();
    if (!current) return;
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    if (!commit || current.to === current.from) return;
    const others = latest.current.ids.filter((id) => id !== current.id);
    latest.current.onMove(current.id, others[current.to] ?? null);
  };

  // While dragging, a finger must not scroll the page (the browser would also cancel the pointer).
  useEffect(() => {
    const block = (event: TouchEvent) => {
      if (live.current && event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      document.removeEventListener("touchmove", block);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      clearTimeout(press.current?.timer);
    };
  }, []);

  const handlers = (id: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || live.current) return;
      const target = event.target as HTMLElement;
      // Text being edited: a long press there selects words.
      if (target.closest("input, textarea:focus, [data-no-drag]")) return;
      cancelPress();
      const start: Press = {
        id,
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element: event.currentTarget,
      };
      start.timer = setTimeout(() => begin(start), LONG_PRESS_MS);
      press.current = start;
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (live.current) return follow(event.clientY);
      const start = press.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX)
        cancelPress();
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onClickCapture: (event: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { drag, handlers };
}
