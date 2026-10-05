// The book: one page for each day with something written, and which page shows where while one is turned.
//
// On a phone the book shows one page at a time: each day is a leaf written on its front only. On a wide screen
// it lies open at a spread: a leaf carries one day on its front (right) and the next on its back (left).

import {
  clampPoint,
  cornerPoint,
  turnedPoint,
  type Corner,
  type Point,
  type Side,
} from "./page-curl";
import { isWritten, type Task } from "./model";
import type { SyncEngine } from "./sync";
import { dayParts } from "./time";

export interface BookPage {
  day: string;
  /** Counted over every year, so numbers run on from one book to the next. */
  number: number;
  tasks: Task[];
}

export interface Book {
  year: number;
  pages: BookPage[];
  /** Written lines in the year. */
  lines: number;
  /** Every year with something written, plus this one, newest first. */
  years: number[];
  /** Every day with something written, in any year, oldest first. */
  days: string[];
}

export function makeBook(engine: SyncEngine, year: number, thisYear: number): Book {
  const byDay = new Map<string, Task[]>();
  for (const task of engine.all("task")) {
    if (!isWritten(task)) continue;
    const list = byDay.get(task.data.day) ?? [];
    list.push(task);
    byDay.set(task.data.day, list);
  }
  const days = [...byDay.keys()].sort();
  const years = new Set([thisYear]);
  const pages: BookPage[] = [];
  days.forEach((day, i) => {
    const y = dayParts(day).year;
    years.add(y);
    if (y !== year) return;
    const tasks = (byDay.get(day) ?? []).sort((a, b) =>
      a.data.position < b.data.position ? -1 : a.data.position > b.data.position ? 1 : 0
    );
    pages.push({ day, number: i + 1, tasks });
  });
  return {
    year,
    pages,
    lines: pages.reduce((sum, page) => sum + page.tasks.length, 0),
    years: [...years].sort((a, b) => b - a),
    days,
  };
}

export type Layout = "single" | "spread";

/** What lies in one place on the book: a day's page, a blank page back, or the inside of the cover. */
export type Face =
  | { type: "page"; index: number }
  | {
      type: "blank";
      /** The page whose ink shows faintly through, mirrored. */ ghost: number | null;
    }
  | { type: "endpaper" };

export const leafCount = (layout: Layout, pages: number): number =>
  layout === "single" ? pages : Math.ceil(pages / 2);

/** The position (leaves turned) at which a page shows. */
export const positionOf = (layout: Layout, index: number): number =>
  layout === "single" ? index : Math.ceil(index / 2);

/** The page shown first at a position: the right one, or the left one past the last right page. */
export const pagesAt = (layout: Layout, pages: number, position: number): number[] =>
  layout === "single"
    ? [position]
    : [position * 2 - 1, position * 2].filter((index) => index >= 0 && index < pages);

export function rightOf(layout: Layout, pages: number, leaf: number): Face {
  const index = layout === "single" ? leaf : leaf * 2;
  return index >= 0 && index < pages ? { type: "page", index } : { type: "endpaper" };
}

export function backOf(layout: Layout, pages: number, leaf: number): Face {
  if (layout === "single") return { type: "blank", ghost: leaf };
  const index = leaf * 2 + 1;
  return index < pages ? { type: "page", index } : { type: "blank", ghost: null };
}

export const leftOf = (layout: Layout, pages: number, leaf: number): Face =>
  leaf <= 0 ? { type: "endpaper" } : backOf(layout, pages, leaf - 1);

export type Direction = "next" | "prev";

export interface Turn {
  /** The leaf being turned. */
  leaf: number;
  /** Where it lies when flat: a right page turns forward, a left page backward. */
  side: Side;
  corner: Corner;
  /** Where its corner is, in the turned page's canonical coordinates (see page-curl). */
  point: Point;
  /** True for a phone turning back: the previous leaf is turned forward in reverse. */
  reverse: boolean;
}

export function canTurn(
  layout: Layout,
  pages: number,
  position: number,
  direction: Direction
): boolean {
  if (direction === "prev") return position > 0;
  return layout === "single" ? position < pages - 1 : position * 2 + 1 < pages;
}

/** A turn starting from rest at a position. */
export function startTurn(
  layout: Layout,
  position: number,
  direction: Direction,
  corner: Corner,
  w: number,
  h: number
): Turn {
  if (direction === "next") {
    return {
      leaf: position,
      side: "right",
      corner,
      point: cornerPoint(corner, w, h),
      reverse: false,
    };
  }
  if (layout === "single") {
    return {
      leaf: position - 1,
      side: "right",
      corner,
      point: turnedPoint(corner, w, h),
      reverse: true,
    };
  }
  return {
    leaf: position - 1,
    side: "left",
    corner,
    point: cornerPoint(corner, w, h),
    reverse: false,
  };
}

/**
 * The corner's place for a finger moved by `delta` (stage pixels) since the turn's point was where it is. A left
 * page sees the stage mirrored; a phone turning back moves the corner twice as fast, so a swipe across the page
 * is a full turn.
 */
export function dragPoint(turn: Turn, delta: Point, w: number, h: number): Point {
  const dx = turn.reverse ? delta.x * 2 : turn.side === "right" ? delta.x : -delta.x;
  return clampPoint({ x: turn.point.x + dx, y: turn.point.y + delta.y }, turn.corner, w, h);
}

const FLICK = 0.35; // px per ms

/**
 * On letting go: does the page finish turning over or fall back flat? A flick decides; otherwise how far over
 * it already is. `velocity` is the finger's, in stage pixels per ms.
 */
export function settle(turn: Turn, progress: number, velocity: number): "turned" | "flat" {
  // Moving the finger left turns a right page over, and right turns a left page over.
  const over = turn.side === "right" ? -velocity : velocity;
  if (over > FLICK) return "turned";
  if (over < -FLICK) return "flat";
  if (turn.reverse) return progress > 0.65 ? "turned" : "flat";
  return progress > 0.3 ? "turned" : "flat";
}

/** The position once a turn has ended `turned` or `flat`. */
export function endTurn(turn: Turn, end: "turned" | "flat"): number {
  if (turn.side === "left") return end === "turned" ? turn.leaf : turn.leaf + 1;
  return end === "turned" ? turn.leaf + 1 : turn.leaf;
}

export interface Faces {
  left: Face;
  right: Face;
  /** The turned leaf's face that lay up when it was flat, and the one on its other side. */
  front: Face | null;
  back: Face | null;
  /** Leaves under the left and right pages, for the thickness of the paper at the edges. */
  leftLeaves: number;
  rightLeaves: number;
}

export function facesAt(layout: Layout, pages: number, position: number, turn: Turn | null): Faces {
  const leaves = leafCount(layout, pages);
  if (!turn) {
    return {
      left: leftOf(layout, pages, position),
      right: rightOf(layout, pages, position),
      front: null,
      back: null,
      leftLeaves: position,
      rightLeaves: leaves - position,
    };
  }
  const L = turn.leaf;
  const base = {
    left: leftOf(layout, pages, L),
    right: rightOf(layout, pages, L + 1),
    leftLeaves: L,
    rightLeaves: leaves - L - 1,
  };
  return turn.side === "right"
    ? { ...base, front: rightOf(layout, pages, L), back: backOf(layout, pages, L) }
    : { ...base, front: backOf(layout, pages, L), back: rightOf(layout, pages, L) };
}
