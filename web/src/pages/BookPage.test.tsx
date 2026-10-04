import { act, cleanup, createEvent, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeApi } from "../test-support/fake-api";
import { renderApp, seedTask, synced, type FakeApi } from "../test-support/render-app";
import { bookGeometry } from "./BookPage";

type Geometry = ReturnType<typeof bookGeometry>;
const SINGLE = bookGeometry(375, 640, "single");
const SPREAD = bookGeometry(375, 640, "spread");

let now = 10_000;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

/** Runs the animation frames waiting now, `ms` later. */
function flush(ms = 1000) {
  act(() => {
    now += ms;
    const waiting = [...frames.values()];
    frames.clear();
    waiting.forEach((callback) => callback(now));
  });
}

/** Lets every running page turn finish. */
function settleAll() {
  for (let i = 0; i < 10 && frames.size > 0; i += 1) flush();
}

function media(matches: Record<string, boolean>) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  now = 10_000;
  frames.clear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameId += 1;
    frames.set(frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stage = () => screen.getByTestId("book-stage");
const world = () => document.querySelector(".book-world") as HTMLElement;
const face = (name: string) => document.querySelector(`[data-face="${name}"]`);
const hash = () => window.location.hash;

type PointerKind = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel";
interface PointerInit {
  id?: number;
  type?: string;
  button?: number;
  timeStamp?: number;
  g?: Geometry;
}

/** A pointer event at (x, y) in the turned page's stage coordinates (spine at x = 0). */
function pointer(kind: PointerKind, x: number, y: number, init: PointerInit = {}) {
  const g = init.g ?? SINGLE;
  const event = createEvent[kind](stage(), {
    clientX: g.x + x,
    clientY: g.y + y,
    pointerId: init.id ?? 1,
    pointerType: init.type ?? "touch",
    button: init.button ?? 0,
  });
  if (init.timeStamp !== undefined)
    Object.defineProperty(event, "timeStamp", { value: init.timeStamp });
  fireEvent(stage(), event);
}

/** A finger down, moved through `points` a second apart, and up at the last one. */
function swipe(points: [number, number][], init: PointerInit = {}) {
  const [first, ...rest] = points as [[number, number], ...[number, number][]];
  pointer("pointerDown", first[0], first[1], init);
  for (const [x, y] of rest) {
    now += 1000;
    pointer("pointerMove", x, y, init);
  }
  const last = rest.at(-1) ?? first;
  pointer("pointerUp", last[0], last[1], init);
}

const tap = (x: number, y: number, init: PointerInit = {}) => {
  pointer("pointerDown", x, y, { ...init, timeStamp: 100 });
  pointer("pointerUp", x, y, { ...init, timeStamp: 150 });
};

function seedBook(api: FakeApi) {
  seedTask(api, "2025-05-01", "去年的一行");
  seedTask(api, "2026-10-01", "   ");
  seedTask(api, "2026-10-02", "十月二日");
  seedTask(api, "2026-10-03", "十月三日");
  seedTask(api, "2026-10-03", "第二行 #作文", { done: true, duration: 30 });
  seedTask(api, "2026-10-04", "今天写的");
}

async function book(hashValue: string, seed: (api: FakeApi) => void = seedBook) {
  const api = createFakeApi();
  seed(api);
  return renderApp({ api, hash: hashValue });
}

const go = (value: string) =>
  act(() => {
    window.history.replaceState(null, "", value);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const stat = (label: string) => screen.getByText(label).previousElementSibling?.textContent;

describe("bookGeometry", () => {
  it("fits one page with a sliver of the one before, or a spread", () => {
    expect(SINGLE).toEqual({ w: 341, h: 518, x: 23, y: 61 });
    expect(bookGeometry(1600, 1000, "spread")).toEqual({ w: 460, h: 634, x: 800, y: 183 });
  });
});

describe("BookPage closed", () => {
  it("shows the cover with the counts, and switches years", async () => {
    await book("#/book");
    expect(screen.getByRole("region", { name: "本子封面" })).toBeTruthy();
    expect(stat("已写")).toBe("3");
    expect(stat("条")).toBe("4");
    expect(screen.getAllByRole("button", { name: "打开今天" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /合上/ })).toBeNull();

    const yearButton = screen.getByRole("button", { name: "2026 年，换一年" });
    fireEvent.click(yearButton);
    expect(yearButton.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(hash()).toBe("#/book/2025");
    expect(screen.getAllByRole("button", { name: "打开本子" })).toHaveLength(2);
    expect(stat("已写")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "2025 年，换一年" }));
    fireEvent.click(screen.getByRole("button", { name: "2026" }));
    expect(hash()).toBe("#/book");
    fireEvent.click(screen.getByRole("button", { name: "2026 年，换一年" }));
    fireEvent.click(screen.getByRole("button", { name: "2026 年，换一年" }));
    expect(screen.queryByRole("button", { name: "2025" })).toBeNull();
  });

  it("asks for the first day when nothing is written", async () => {
    await book("#/book", () => {});
    expect(stat("已写")).toBe("0");
    expect(screen.queryByTestId("book-stage")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "去写第一天" }));
    expect(hash()).toBe("#/");
  });

  it("opens with the cover turning, and closes again", async () => {
    await book("#/book");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getAllByRole("button", { name: "打开今天" })[1] as HTMLElement);
    expect(hash()).toBe("#/book?day=2026-10-04");
    expect(world().className).toContain("phase-opening");
    expect((document.querySelector(".book-cover") as HTMLElement).style.transform).toBe(
      "rotateY(-180deg)"
    );
    act(() => vi.advanceTimersByTime(1100));
    expect(world().className).toContain("phase-open");
    expect(document.querySelector(".book-cover")).toBeNull();
    expect(screen.getByRole("region", { name: "本子，10月4日" })).toBeTruthy();
    expect(face("right")?.textContent).toContain("今天写的");

    fireEvent.click(screen.getByRole("button", { name: /合上/ }));
    expect(world().className).toContain("phase-closing-start");
    expect((document.querySelector(".book-cover") as HTMLElement).style.transition).toBe("none");
    flush(16);
    flush(16);
    expect(world().className).toContain("phase-closing");
    expect(screen.getByRole("region", { name: "本子封面" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(world().className).toContain("phase-closed");
  });

  it("opens another year's book at its last page", async () => {
    await book("#/book/2025");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getAllByRole("button", { name: "打开本子" })[0] as HTMLElement);
    expect(hash()).toBe("#/book/2025?day=2025-05-01");
    act(() => vi.advanceTimersByTime(500));
    expect(world().className).toContain("phase-opening");
    act(() => vi.advanceTimersByTime(600));
    expect(world().className).toContain("phase-open");
    expect(face("right")?.textContent).toContain("去年的一行");
    // The first page has the inside of the cover on its left, with the year.
    expect(face("left")?.textContent).toBe("2025");
  });
});

describe("BookPage open at a day", () => {
  it("starts open on the day in the route; another year starts closed", async () => {
    await book("#/book?day=2026-10-02");
    expect(world().className).toContain("phase-open");
    expect(screen.getByRole("region", { name: "本子，10月2日" })).toBeTruthy();
    expect(face("right")?.textContent).toContain("十月二日");

    go("#/book/2025");
    expect(world().className).toContain("phase-closed");
    go("#/book?day=2026-10-03");
    expect(world().className).toContain("phase-open");
    expect(face("right")?.textContent).toContain("30min");
  });

  it("falls back to today for a day without a page", async () => {
    await book("#/book?day=2026-01-01");
    expect(screen.getByRole("region", { name: "本子，10月4日" })).toBeTruthy();
  });
});

describe("BookStage turning, one page", () => {
  it("turns forward when dragged far enough", async () => {
    await book("#/book?day=2026-10-03");
    pointer("pointerDown", 300, 450);
    now += 1000;
    pointer("pointerMove", 280, 450);
    // Lifted but not yet moved: the page still lies flat.
    expect(face("back")).toBeNull();
    now += 1000;
    pointer("pointerMove", 20, 440);
    expect(face("back")).not.toBeNull();
    expect(face("front")).not.toBeNull();
    pointer("pointerUp", 20, 440);
    flush(100);
    expect(face("back")).not.toBeNull();
    expect(hash()).toBe("#/book?day=2026-10-03");
    flush(1000);
    expect(face("back")).toBeNull();
    expect(hash()).toBe("#/book?day=2026-10-04");
  });

  it("falls back flat after a small drag (a few pixels do not start a turn)", async () => {
    await book("#/book?day=2026-10-03");
    swipe([
      [300, 450],
      [296, 451],
      [280, 450],
      [250, 450],
    ]);
    settleAll();
    expect(face("back")).toBeNull();
    expect(hash()).toBe("#/book?day=2026-10-03");
  });

  it("lets go of a lifted corner that has not moved without animating", async () => {
    await book("#/book?day=2026-10-03");
    swipe([
      [300, 450],
      [290, 450],
    ]);
    expect(frames.size).toBe(0);
    expect(hash()).toBe("#/book?day=2026-10-03");
  });

  it("turns back by dragging to the right", async () => {
    await book("#/book?day=2026-10-03");
    pointer("pointerDown", 40, 450);
    now += 1000;
    pointer("pointerMove", 60, 450);
    now += 1000;
    pointer("pointerMove", 300, 450);
    expect(face("back")).not.toBeNull();
    pointer("pointerUp", 300, 450);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-02");
  });

  it("turns on a flick even when the page has hardly moved", async () => {
    await book("#/book?day=2026-10-03");
    pointer("pointerDown", 200, 450);
    now += 1;
    pointer("pointerMove", 190, 450);
    pointer("pointerUp", 190, 450);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");
  });

  it("turns by the top corner too", async () => {
    await book("#/book?day=2026-10-03");
    swipe([
      [300, 50],
      [280, 50],
      [20, 60],
    ]);
    flush(300);
    expect(face("back")).not.toBeNull();
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");
  });

  it("leaves a vertical drag to scrolling", async () => {
    await book("#/book?day=2026-10-03");
    swipe([
      [200, 300],
      [202, 360],
      [100, 360],
    ]);
    expect(face("back")).toBeNull();
    expect(frames.size).toBe(0);
    expect(hash()).toBe("#/book?day=2026-10-03");
  });

  it("does not turn past the last page", async () => {
    await book("#/book?day=2026-10-04");
    swipe([
      [300, 450],
      [280, 450],
      [20, 450],
    ]);
    expect(face("back")).toBeNull();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(frames.size).toBe(0);
  });

  it("ignores other buttons and other pointers", async () => {
    await book("#/book?day=2026-10-03");
    pointer("pointerUp", 200, 200);
    pointer("pointerDown", 200, 200, { button: 2 });
    pointer("pointerMove", 100, 200);
    pointer("pointerUp", 100, 200);
    pointer("pointerDown", 200, 200, { id: 1 });
    pointer("pointerMove", 100, 200, { id: 2 });
    pointer("pointerUp", 100, 200, { id: 2 });
    pointer("pointerCancel", 100, 200);
    expect(face("back")).toBeNull();
    expect(hash()).toBe("#/book?day=2026-10-03");
  });

  it("lets a cancelled drag fall back where it was", async () => {
    await book("#/book?day=2026-10-03");
    pointer("pointerDown", 300, 450);
    now += 1000;
    pointer("pointerMove", 280, 450);
    now += 1000;
    pointer("pointerMove", 100, 450);
    pointer("pointerCancel", 100, 450);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-03");

    pointer("pointerDown", 40, 450);
    now += 1000;
    pointer("pointerMove", 60, 450);
    now += 1000;
    pointer("pointerMove", 200, 450);
    pointer("pointerCancel", 200, 450);
    settleAll();
    expect(face("back")).toBeNull();
    expect(hash()).toBe("#/book?day=2026-10-03");
  });

  it("turns on taps at the outer edges and opens the day on a tap in the middle", async () => {
    await book("#/book?day=2026-10-03");
    tap(SINGLE.w * 0.9, 300);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");
    tap(SINGLE.w * 0.1, 300);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-03");
    tap(-10, 300);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-02");

    // A long press, or a finger that moved, is not a tap.
    pointer("pointerDown", 170, 300, { timeStamp: 100 });
    pointer("pointerUp", 170, 300, { timeStamp: 900 });
    pointer("pointerDown", 170, 300, { timeStamp: 100 });
    pointer("pointerUp", 200, 300, { timeStamp: 150 });
    expect(hash()).toBe("#/book?day=2026-10-02");

    tap(170, 300);
    expect(hash()).toBe("#/day/2026-10-02");
  });

  it("opens today's page as today", async () => {
    await book("#/book?day=2026-10-04");
    tap(170, 300);
    expect(hash()).toBe("#/");
  });

  it("turns with the arrow and page keys, but not while typing", async () => {
    await book("#/book?day=2026-10-03");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    // A second key while the page is still turning does nothing.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");
    fireEvent.keyDown(document.body, { key: "PageUp" });
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-03");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-02");
    fireEvent.keyDown(document.body, { key: "PageDown" });
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-03");
    fireEvent.keyDown(document.body, { key: "Enter" });

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(frames.size).toBe(0);
    input.remove();
  });

  it("does not take a new drag while a page is still turning", async () => {
    await book("#/book?day=2026-10-03");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    pointer("pointerDown", 300, 450);
    pointer("pointerMove", 335, 512, { type: "mouse" });
    now += 1000;
    pointer("pointerMove", 100, 450);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");
  });

  it("stops the animation when the book goes away", async () => {
    const { view } = await book("#/book?day=2026-10-03");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  });

  it("lifts the corner under a mouse, and turns from there", async () => {
    await book("#/book?day=2026-10-03");
    pointer("pointerMove", 335, 512, { type: "mouse" });
    expect(face("back")).not.toBeNull();
    pointer("pointerMove", 150, 200, { type: "mouse" });
    expect(face("back")).toBeNull();
    pointer("pointerMove", 150, 200, { type: "mouse" });
    pointer("pointerMove", 150, 200, { type: "touch" });

    pointer("pointerMove", 335, 512, { type: "mouse" });
    fireEvent.pointerLeave(stage());
    expect(face("back")).toBeNull();
    fireEvent.pointerLeave(stage());

    pointer("pointerMove", 335, 512, { type: "mouse" });
    swipe(
      [
        [335, 512],
        [315, 512],
        [20, 500],
      ],
      { type: "mouse" }
    );
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");

    // Nothing to lift on the last page.
    pointer("pointerMove", 335, 512, { type: "mouse" });
    expect(face("back")).toBeNull();
  });
});

describe("BookStage turning, a spread", () => {
  const seedSpread = (api: FakeApi) => {
    seedTask(api, "2026-10-01", "一");
    seedTask(api, "2026-10-02", "二");
    seedTask(api, "2026-10-03", "三");
    seedTask(api, "2026-10-04", "四");
  };
  const spread = async (hashValue: string) => {
    media({ "(min-width: 1024px)": true });
    return book(hashValue, seedSpread);
  };
  const g = { g: SPREAD };

  it("shows two pages and opens the left one on a tap", async () => {
    await spread("#/book?day=2026-10-02");
    expect(screen.getByRole("region", { name: "本子，10月2日、10月3日" })).toBeTruthy();
    expect(face("left")?.textContent).toContain("二");
    expect(face("right")?.textContent).toContain("三");
    tap(-SPREAD.w / 2, 100, g);
    expect(hash()).toBe("#/day/2026-10-02");
  });

  it("opens the right page on a tap", async () => {
    await spread("#/book?day=2026-10-02");
    tap(SPREAD.w / 2, 100, g);
    expect(hash()).toBe("#/day/2026-10-03");
  });

  it("turns back on a tap at the left edge and forward at the right edge", async () => {
    await spread("#/book?day=2026-10-02");
    tap(-SPREAD.w * 0.9, 100, g);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-01");
    // Only the inside of the cover on the left: a tap there opens nothing.
    tap(-SPREAD.w / 2, 100, g);
    expect(hash()).toBe("#/book?day=2026-10-01");
    tap(SPREAD.w * 0.9, 100, g);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-03");
    expect(screen.getByRole("region", { name: "本子，10月2日、10月3日" })).toBeTruthy();
  });

  it("turns the left page back by dragging it", async () => {
    await spread("#/book?day=2026-10-02");
    pointer("pointerDown", -120, 170, g);
    now += 1000;
    pointer("pointerMove", -110, 170, g);
    now += 1000;
    pointer("pointerMove", 100, 170, g);
    expect(face("back")).not.toBeNull();
    pointer("pointerUp", 100, 170, g);
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-01");
  });

  it("turns the right page forward to the last one", async () => {
    await spread("#/book?day=2026-10-02");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    settleAll();
    expect(hash()).toBe("#/book?day=2026-10-04");
    expect(screen.getByRole("region", { name: "本子，10月4日" })).toBeTruthy();
    expect(face("right")?.firstElementChild?.className).toContain("endpaper");
  });
});

describe("BookPage with reduced motion", () => {
  beforeEach(() => media({ "(prefers-reduced-motion: reduce)": true }));

  it("opens, turns and closes at once", async () => {
    await book("#/book");
    fireEvent.click(screen.getAllByRole("button", { name: "打开今天" })[0] as HTMLElement);
    expect(world().className).toContain("phase-open");
    expect(face("right")?.className).toBe("fade-in");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(frames.size).toBe(0);
    expect(hash()).toBe("#/book?day=2026-10-03");
    fireEvent.click(screen.getByRole("button", { name: /合上/ }));
    expect(world().className).toContain("phase-closed");
  });

  it("turns on the wheel at most twice a second", async () => {
    await book("#/book?day=2026-10-03");
    fireEvent.wheel(stage(), { deltaY: 10 });
    expect(hash()).toBe("#/book?day=2026-10-03");
    fireEvent.wheel(stage(), { deltaY: 100 });
    expect(hash()).toBe("#/book?day=2026-10-04");
    now += 100;
    fireEvent.wheel(stage(), { deltaY: -100 });
    expect(hash()).toBe("#/book?day=2026-10-04");
    now += 600;
    fireEvent.wheel(stage(), { deltaX: -100, deltaY: 5 });
    expect(hash()).toBe("#/book?day=2026-10-03");
  });
});

describe("BookPage size", () => {
  const rect = (width: number, height: number) =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  const spine = () => stage().firstElementChild as HTMLElement;

  it("follows the space it has through a ResizeObserver", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(800, 900));
    const disconnect = vi.fn();
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const { view } = await book("#/book?day=2026-10-03");
    expect(spine().style.left).toBe(`${bookGeometry(800, 900, "single").x}px`);
    expect(observers.length).toBeGreaterThan(0);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("measures again on resize when there is no ResizeObserver", async () => {
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rect(0, 0));
    await book("#/book?day=2026-10-03");
    expect(spine().style.left).toBe(`${SINGLE.x}px`);
    box.mockReturnValue(rect(700, 800));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(spine().style.left).toBe(`${bookGeometry(700, 800, "single").x}px`);
  });
});

describe("BookPage covers", () => {
  it("changes the cover to another painting", async () => {
    const { api, store } = await book("#/book");
    fireEvent.click(screen.getByRole("button", { name: "换封面" }));
    const dialog = screen.getByRole("dialog", { name: "本子封面" });
    expect(dialog).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "莫奈《鲁昂大教堂》" }).getAttribute("aria-pressed")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "梵高《杏花》" }));
    expect(screen.getByRole("button", { name: "梵高《杏花》" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(document.querySelector(".book-cover img")?.getAttribute("src")).toBe(
      "/covers/almond.webp"
    );
    await synced(store);
    expect(api.data("settings", "settings")).toMatchObject({ cover: "almond" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uploads her own picture, shrunk to a cover", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1200, height: 860 }))
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,AAAA"
    );
    const { api, store } = await book("#/book");
    fireEvent.click(screen.getByRole("button", { name: "换封面" }));
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "我的图片" })).toBeTruthy());
    expect(document.querySelector(".book-cover img")?.getAttribute("src")).toBe(
      "data:image/jpeg;base64,AAAA"
    );
    await synced(store);
    expect(api.data("cover", "cover")).toEqual({ image: "data:image/jpeg;base64,AAAA" });
    expect(api.data("settings", "settings")).toMatchObject({ cover: "upload" });
  });
});
