import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskData } from "@shared/records";
import { tasksOfDay } from "../lib/model";
import type { SyncEngine } from "../lib/sync";
import { createFakeApi } from "../test-support/fake-api";
import { renderApp, seedTask, synced, TODAY } from "../test-support/render-app";

const YESTERDAY = "2026-10-03";
const TOMORROW = "2026-10-05";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const list = () => screen.getByRole("list", { name: "任务" });
const lines = () => screen.queryAllByRole("textbox", { name: "任务" }) as HTMLTextAreaElement[];
const line = (index: number) => {
  const area = lines()[index];
  if (!area) throw new Error(`no line ${index}`);
  return area;
};
const newLine = () => screen.getByRole("textbox", { name: "新任务" }) as HTMLTextAreaElement;
const texts = (engine: SyncEngine, day = TODAY) => tasksOfDay(engine, day).map((t) => t.data.text);
const dataOf = (engine: SyncEngine, id: string): TaskData => {
  const task = engine.get("task", id);
  if (!task) throw new Error(`no task ${id}`);
  return task.data;
};
const rowOf = (area: HTMLElement) => area.closest("li") as HTMLLIElement;
const footer = () => document.querySelector("footer")?.textContent ?? "";
const toolbar = () => screen.getByRole("toolbar", { name: "编辑这一行" });
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** Focuses a line, puts the caret at `start`..`end`, and presses a key. */
function press(
  area: HTMLTextAreaElement,
  key: string,
  caret: number | "end" = "end",
  options: { shiftKey?: boolean; keyCode?: number } = {}
) {
  act(() => area.focus());
  const at = caret === "end" ? area.value.length : caret;
  area.setSelectionRange(at, at);
  fireEvent.keyDown(area, { key, ...options });
}

function type(area: HTMLTextAreaElement, value: string) {
  act(() => area.focus());
  fireEvent.change(area, { target: { value } });
}

describe("TodayPage header and footer", () => {
  it("shows today with its weekday and a zero total", async () => {
    await renderApp();
    const header = document.querySelector("header") as HTMLElement;
    expect(header.textContent).toContain("10月4日");
    expect(header.textContent).toContain("今天");
    expect(header.textContent).toContain("周日");
    expect(screen.queryByRole("button", { name: /回到今天/ })).toBeNull();
    expect(footer()).toContain("今日总计");
    expect(footer()).toContain("0min");
  });

  it("adds up the minutes of the day", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "阅读", { done: true, duration: 45 });
    seedTask(api, TODAY, "写作", { done: true, duration: 28 });
    seedTask(api, YESTERDAY, "别的天", { done: true, duration: 600 });
    await renderApp({ api });
    expect(footer()).toContain("1h13min");
  });

  it("moves between days and back to today", async () => {
    const api = createFakeApi();
    seedTask(api, YESTERDAY, "昨天的事", { done: true });
    await renderApp({ api });

    fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    expect(window.location.hash).toBe(`#/day/${YESTERDAY}`);
    const header = document.querySelector("header") as HTMLElement;
    expect(header.textContent).toContain("10月3日");
    expect(header.textContent).toContain("昨天");
    expect(footer()).toContain("当日总计");
    expect(list().textContent).toContain("昨天的事");

    fireEvent.click(screen.getByRole("button", { name: /回到今天/ }));
    expect(window.location.hash).toBe("#/");
    expect(document.querySelector("header")?.textContent).toContain("今天");

    fireEvent.click(screen.getByRole("button", { name: "后一天" }));
    expect(window.location.hash).toBe(`#/day/${TOMORROW}`);
    expect(document.querySelector("header")?.textContent).toContain("明天");
    fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    expect(window.location.hash).toBe("#/");
  });

  it("names the year of a day in another year", async () => {
    await renderApp({ hash: "#/day/2025-12-31" });
    const header = document.querySelector("header") as HTMLElement;
    expect(header.textContent).toContain("2025年");
    expect(header.textContent).toContain("12月31日");
    expect(header.querySelector("h1")?.parentElement?.textContent).toBe("12月31日2025年");
  });
});

describe("TodayPage calendar", () => {
  it("picks a day from the month, with dots on written days", async () => {
    const api = createFakeApi();
    seedTask(api, "2026-10-02", "写过");
    seedTask(api, "2026-10-08", "   ");
    await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    const sheet = screen.getByRole("dialog", { name: "选一天" });
    expect(sheet.textContent).toContain("2026年10月");
    const todayButton = within(sheet).getByRole("button", { name: TODAY });
    expect(todayButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      within(sheet).getByRole("button", { name: "2026-10-02" }).querySelector("span")
    ).not.toBeNull();
    expect(
      within(sheet).getByRole("button", { name: "2026-10-08" }).querySelector("span")
    ).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "下个月" }));
    expect(sheet.textContent).toContain("2026年11月");
    fireEvent.click(within(sheet).getByRole("button", { name: "上个月" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "上个月" }));
    expect(sheet.textContent).toContain("2026年9月");
    fireEvent.click(within(sheet).getByRole("button", { name: "下个月" }));

    fireEvent.click(within(sheet).getByRole("button", { name: "2026-10-12" }));
    expect(window.location.hash).toBe("#/day/2026-10-12");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("header")?.textContent).toContain("10月12日");
  });

  it("crosses the year and goes back to today from the calendar", async () => {
    await renderApp({ hash: "#/day/2026-01-15" });
    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    const sheet = screen.getByRole("dialog", { name: "选一天" });
    expect(sheet.textContent).toContain("2026年1月");
    fireEvent.click(within(sheet).getByRole("button", { name: "上个月" }));
    expect(sheet.textContent).toContain("2025年12月");
    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    const again = screen.getByRole("dialog", { name: "选一天" });
    for (let i = 0; i < 9; i += 1)
      fireEvent.click(within(again).getByRole("button", { name: "下个月" }));
    expect(again.textContent).toContain("2026年10月");
    const today = within(again).getByRole("button", { name: TODAY });
    expect(today.className).toContain("text-accent-ink");
    fireEvent.click(today);
    expect(window.location.hash).toBe("#/");
  });

  it("closes on Escape and on the backdrop", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    const backdrop = screen.getByRole("dialog").parentElement?.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TodayPage new line", () => {
  it("adds a task with Enter and keeps the line for the next one", async () => {
    const { api, store, engine } = await renderApp();
    type(newLine(), "买菜 #生活");
    fireEvent.keyDown(newLine(), { key: "Enter" });
    expect(texts(engine)).toEqual(["买菜 #生活"]);
    expect(newLine().value).toBe("");
    expect(list().textContent).toContain("买菜 #生活");
    const id = tasksOfDay(engine, TODAY)[0]?.id as string;
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ day: TODAY, text: "买菜 #生活", indent: 0 });
  });

  it("adds what a soft keyboard sends with a line break, and on blur", async () => {
    const { engine } = await renderApp();
    type(newLine(), "第一\n");
    expect(texts(engine)).toEqual(["第一"]);
    type(newLine(), "第二");
    fireEvent.blur(newLine());
    expect(texts(engine)).toEqual(["第一", "第二"]);
    fireEvent.blur(newLine());
    expect(texts(engine)).toEqual(["第一", "第二"]);
    fireEvent.keyDown(newLine(), { key: "Enter" });
    expect(texts(engine)).toHaveLength(2);
  });

  it("ignores keys while an IME is composing", async () => {
    const { engine } = await renderApp();
    type(newLine(), "拼音");
    fireEvent.keyDown(newLine(), { key: "Enter", keyCode: 229 });
    expect(texts(engine)).toEqual([]);
  });

  it("indents with two spaces, a full-width space and Tab; outdents with Backspace, Enter and Shift+Tab", async () => {
    const { engine } = await renderApp();
    const row = () => rowOf(newLine());
    type(newLine(), "  ");
    expect(row().style.paddingLeft).toBe("24px");
    expect(newLine().value).toBe("");
    fireEvent.keyDown(newLine(), { key: "Enter" });
    expect(row().style.paddingLeft).toBe("0px");

    type(newLine(), "　");
    expect(row().style.paddingLeft).toBe("24px");
    press(newLine(), "Backspace", 0);
    expect(row().style.paddingLeft).toBe("0px");

    press(newLine(), "Tab");
    press(newLine(), "Tab");
    expect(row().style.paddingLeft).toBe("48px");
    press(newLine(), "Tab", "end", { shiftKey: true });
    expect(row().style.paddingLeft).toBe("24px");

    type(newLine(), "子项");
    fireEvent.keyDown(newLine(), { key: "Enter" });
    expect(tasksOfDay(engine, TODAY)[0]?.data.indent).toBe(1);
    // The next line starts at the same level.
    expect(row().style.paddingLeft).toBe("24px");
  });

  it("starts at the indent of the last line", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "深", { indent: 2 });
    await renderApp({ api });
    expect(rowOf(newLine()).style.paddingLeft).toBe("48px");
  });

  it("goes up to the last line with Backspace or ArrowUp, and nowhere when there is none", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "上一行");
    await renderApp({ api });
    press(newLine(), "Backspace", 0);
    await waitFor(() => expect(document.activeElement).toBe(line(0)));
    expect(line(0).selectionStart).toBe(3);

    press(newLine(), "ArrowDown", 0);
    expect(document.activeElement).toBe(newLine());
    press(newLine(), "ArrowUp", 0);
    await waitFor(() => expect(document.activeElement).toBe(line(0)));
  });

  it("stays put with no lines above", async () => {
    await renderApp();
    press(newLine(), "Backspace", 0);
    press(newLine(), "ArrowUp", 0);
    expect(document.activeElement).toBe(newLine());
  });

  it("focuses when its row is clicked", async () => {
    await renderApp();
    fireEvent.click(rowOf(newLine()));
    expect(document.activeElement).toBe(newLine());
  });
});

describe("TodayPage editing a line", () => {
  it("saves typed text after a pause, and on blur", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "旧");
    const { engine, store } = await renderApp({ api });
    type(line(0), "新");
    type(line(0), "新的");
    expect(dataOf(engine, id).text).toBe("旧");
    await waitFor(() => expect(dataOf(engine, id).text).toBe("新的"), { timeout: 2000 });

    type(line(0), "再改");
    fireEvent.blur(line(0));
    expect(dataOf(engine, id).text).toBe("再改");
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ text: "再改" });

    act(() => line(0).focus());
    fireEvent.blur(line(0));
    expect(dataOf(engine, id).text).toBe("再改");
  });

  it("deletes a line emptied and left", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "要删");
    const { engine, store } = await renderApp({ api });
    type(line(0), "");
    fireEvent.blur(line(0));
    expect(engine.get("task", id)).toBeNull();
    await synced(store);
    expect(api.data("task", id)).toBeNull();
  });

  it("drops a pending save when the page goes", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "旧");
    const { engine } = await renderApp({ api });
    type(line(0), "没存");
    cleanup();
    await wait(800);
    expect(dataOf(engine, id).text).toBe("旧");
  });

  it("splits a line with Enter in the middle", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "买菜做饭", { indent: 1 });
    seedTask(api, TODAY, "洗碗");
    const { engine, store } = await renderApp({ api });
    press(line(0), "Enter", 2);
    expect(texts(engine)).toEqual(["买菜", "做饭", "洗碗"]);
    const second = tasksOfDay(engine, TODAY)[1] as { id: string; data: TaskData };
    expect(second.data.indent).toBe(1);
    await waitFor(() => expect(document.activeElement).toBe(line(1)));
    expect(line(1).selectionStart).toBe(0);
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ text: "买菜" });
    expect(api.data("task", second.id)).toMatchObject({ text: "做饭", indent: 1 });
  });

  it("splits what a soft keyboard sends as a line break", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "ab");
    const { engine } = await renderApp({ api });
    type(line(0), "a\nb\n");
    expect(texts(engine)).toEqual(["a", "b"]);
  });

  it("opens a blank line above with Enter at the start", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "A");
    const b = seedTask(api, TODAY, "B");
    const { engine } = await renderApp({ api });
    press(line(1), "Enter", 0);
    expect(texts(engine)).toEqual(["A", "", "B"]);
    await waitFor(() => expect(document.activeElement).toBe(line(2)));
    expect(line(2).value).toBe("B");
    expect(dataOf(engine, b).text).toBe("B");

    press(line(0), "Enter", 0);
    expect(texts(engine)).toEqual(["", "A", "", "B"]);
  });

  it("moves to the new line after Enter at the end of the last line", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "A");
    seedTask(api, TODAY, "B");
    const { engine } = await renderApp({ api });
    press(line(1), "Enter");
    expect(texts(engine)).toEqual(["A", "B"]);
    await waitFor(() => expect(document.activeElement).toBe(newLine()));

    press(line(0), "Enter");
    expect(texts(engine)).toEqual(["A", "", "B"]);
    await waitFor(() => expect(document.activeElement).toBe(line(1)));
  });

  it("outdents an empty indented line with Enter and does nothing at the top level", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "", { indent: 1 });
    const { engine } = await renderApp({ api });
    press(line(0), "Enter", 0);
    expect(dataOf(engine, id).indent).toBe(0);
    press(line(0), "Enter", 0);
    expect(tasksOfDay(engine, TODAY)).toHaveLength(1);
    fireEvent.keyDown(line(0), { key: "Enter", shiftKey: true });
    expect(tasksOfDay(engine, TODAY)).toHaveLength(1);
  });

  it("outdents with Backspace at the start, and leaves a written top-level line alone", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "缩进", { indent: 2 });
    const { engine } = await renderApp({ api });
    press(line(0), "Backspace", 0);
    expect(dataOf(engine, id).indent).toBe(1);
    expect(rowOf(line(0)).style.paddingLeft).toBe("24px");
    press(line(0), "Backspace", 0);
    press(line(0), "Backspace", 0);
    expect(dataOf(engine, id)).toMatchObject({ indent: 0, text: "缩进" });
    press(line(0), "Backspace", 2);
    expect(dataOf(engine, id).text).toBe("缩进");
  });

  it("removes an empty line with Backspace and focuses the one above", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "上面");
    const blank = seedTask(api, TODAY, "");
    const { engine, store } = await renderApp({ api });
    press(line(1), "Backspace", 0);
    expect(engine.get("task", blank)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(line(0)));
    expect(line(0).selectionStart).toBe(2);
    await synced(store);
    expect(api.data("task", blank)).toBeNull();
  });

  it("focuses the line below, or the new line, when the first line goes", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "");
    seedTask(api, TODAY, "下面");
    const { engine } = await renderApp({ api });
    press(line(0), "Backspace", 0);
    expect(texts(engine)).toEqual(["下面"]);
    await waitFor(() => expect(document.activeElement).toBe(line(0)));
    expect(line(0).selectionStart).toBe(0);

    cleanup();
    const solo = createFakeApi();
    seedTask(solo, TODAY, "");
    const second = await renderApp({ api: solo });
    press(line(0), "Backspace", 0);
    expect(texts(second.engine)).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(newLine()));
  });

  it("indents with two leading spaces and keeps the caret", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "学习");
    const { engine } = await renderApp({ api });
    type(line(0), "  学习");
    expect(dataOf(engine, id).indent).toBe(1);
    expect(line(0).value).toBe("学习");
    await waitFor(() => expect(line(0).selectionStart).toBe(2));
    fireEvent.blur(line(0));
    expect(dataOf(engine, id)).toMatchObject({ text: "学习", indent: 1 });
  });

  it("indents with Tab up to the limit and outdents with Shift+Tab", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "层级");
    const { engine } = await renderApp({ api });
    for (let i = 0; i < 5; i += 1) press(line(0), "Tab");
    expect(dataOf(engine, id).indent).toBe(3);
    press(line(0), "Tab", "end", { shiftKey: true });
    expect(dataOf(engine, id).indent).toBe(2);
  });

  it("moves between lines with the arrow keys", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "一");
    seedTask(api, TODAY, "二");
    await renderApp({ api });
    press(line(0), "ArrowUp", 0);
    expect(document.activeElement).toBe(line(0));
    press(line(1), "ArrowUp", 0);
    await waitFor(() => expect(document.activeElement).toBe(line(0)));
    press(line(0), "ArrowDown");
    await waitFor(() => expect(document.activeElement).toBe(line(1)));
    expect(line(1).selectionStart).toBe(0);
    press(line(1), "ArrowDown");
    await waitFor(() => expect(document.activeElement).toBe(newLine()));
    press(line(0), "ArrowDown", 0);
    expect(document.activeElement).toBe(line(0));
    press(line(0), "Enter", 0, { keyCode: 229 });
    expect(lines()).toHaveLength(2);
  });

  it("edits a line tapped on its words or beside them, but not on its box", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "点我");
    await renderApp({ api });
    // Until it is edited, the text box lets taps through to the row.
    expect(line(0).className).toContain("pointer-events-none");
    const box = line(0).parentElement?.parentElement as HTMLElement;
    fireEvent.click(box);
    expect(document.activeElement).toBe(line(0));
    expect(line(0).className).not.toContain("pointer-events-none");
    act(() => line(0).blur());
    fireEvent.click(line(0).parentElement as HTMLElement);
    expect(document.activeElement).toBe(line(0));
    act(() => line(0).blur());
    fireEvent.click(screen.getByRole("button", { name: "标为完成" }));
    expect(document.activeElement).not.toBe(line(0));
  });

  it("has no hint in the new line", async () => {
    await renderApp();
    expect(newLine().getAttribute("placeholder")).toBeNull();
    expect(screen.queryByText(/两个空格缩进/)).toBeNull();
  });

  it("shows tags in their colour", async () => {
    const api = createFakeApi();
    api.remote("tag", "阅读", { name: "阅读", color: "#ff0000" });
    api.remote("tag", "写作", { name: "写作", color: null });
    seedTask(api, TODAY, "R 21-1-3#阅读 #写作");
    seedTask(api, TODAY, "完成 #阅读", { done: true, highlight: "green" });
    await renderApp({ api });
    const spans = [...list().querySelectorAll("span")];
    const red = spans.find((s) => s.textContent === "#阅读") as HTMLElement;
    expect(red.style.color).toBe("rgb(255, 0, 0)");
    const plain = spans.find((s) => s.textContent === "#写作") as HTMLElement;
    expect(plain.getAttribute("style")).toContain("var(--accent-ink");
    expect(list().querySelector(".hl-green")).not.toBeNull();
    expect(list().querySelector(".opacity-80")).not.toBeNull();
  });
});

describe("TodayPage ticking and time spent", () => {
  it("ticks a line done, asks for the time, and unticks it", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "跑步");
    const { engine, store } = await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "标为完成" }));
    expect(dataOf(engine, id)).toMatchObject({
      done: true,
      doneAt: Date.parse("2026-10-04T13:30:00Z"),
    });
    const hint = screen.getByRole("button", { name: "+ 用时" });
    expect(hint.className).toContain("opacity-100");

    fireEvent.click(hint);
    const input = screen.getByRole("textbox", { name: "用时" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "1h13min" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dataOf(engine, id).duration).toBe(73);
    expect(footer()).toContain("1h13min");
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ done: true, duration: 73 });

    fireEvent.click(screen.getByRole("button", { name: "用时 1h13min，点击修改" }));
    const again = screen.getByRole("textbox", { name: "用时" }) as HTMLInputElement;
    expect(again.value).toBe("1h13min");
    fireEvent.keyDown(again, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "用时" })).toBeNull();
    expect(dataOf(engine, id).duration).toBe(73);

    fireEvent.click(screen.getByRole("button", { name: "标为未完成" }));
    expect(dataOf(engine, id)).toMatchObject({ done: false, doneAt: null });
    expect(screen.queryByRole("button", { name: /用时/ })).toBeNull();
  });

  it("hides the hint on a line ticked earlier until hovered", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "早就做完", { done: true });
    await renderApp({ api });
    expect(screen.getByRole("button", { name: "+ 用时" }).className).toContain("opacity-0");
  });

  it("checks the typed time and clears it when emptied", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "写作", { done: true, duration: 30 });
    const { engine } = await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "用时 30min，点击修改" }));
    const input = screen.getByRole("textbox", { name: "用时" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "很久" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.change(input, { target: { value: "" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dataOf(engine, id).duration).toBeNull();
  });

  it("saves a good time on blur and drops a bad one", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "写作", { done: true });
    const { engine } = await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "+ 用时" }));
    let input = screen.getByRole("textbox", { name: "用时" });
    fireEvent.change(input, { target: { value: "乱写" } });
    fireEvent.blur(input);
    expect(screen.queryByRole("textbox", { name: "用时" })).toBeNull();
    expect(dataOf(engine, id).duration).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ 用时" }));
    input = screen.getByRole("textbox", { name: "用时" });
    fireEvent.change(input, { target: { value: "1:30" } });
    fireEvent.blur(input);
    expect(dataOf(engine, id).duration).toBe(90);
  });
});

describe("TodayPage task menu", () => {
  /** Right click on a row, as on a computer. */
  const openMenu = (index = 0) => fireEvent.contextMenu(rowOf(line(index)));

  it("has no highlight in the menu (it is on the toolbar), and opens from the toolbar's ⋯", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "重点");
    await renderApp({ api });
    openMenu();
    const sheet = screen.getByRole("dialog", { name: "重点" });
    expect(within(sheet).queryByRole("button", { name: "黄色" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "上移" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => line(0).focus());
    fireEvent.click(within(toolbar()).getByRole("button", { name: "更多" }));
    expect(screen.getByRole("dialog", { name: "重点" })).toBeTruthy();
  });

  it("saves, clears and checks the time spent", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "计时", { duration: 20 });
    const { engine } = await renderApp({ api });
    openMenu();
    let input = screen.getByRole("textbox", { name: "用时" }) as HTMLInputElement;
    expect(input.value).toBe("20min");
    fireEvent.change(input, { target: { value: "看不懂" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/看不懂这个时间/)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "45" } });
    expect(screen.queryByText(/看不懂这个时间/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(dataOf(engine, id).duration).toBe(45);
    expect(screen.queryByRole("dialog")).toBeNull();

    openMenu();
    input = screen.getByRole("textbox", { name: "用时" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(dataOf(engine, id).duration).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("calls a blank line 这一行", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "  ");
    await renderApp({ api });
    openMenu();
    expect(screen.getByRole("dialog", { name: "这一行" })).toBeTruthy();
  });

  it("moves a line to tomorrow", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "明天再说");
    const { engine, store } = await renderApp({ api });
    openMenu();
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "今天" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "明天" }));
    expect(dataOf(engine, id).day).toBe(TOMORROW);
    expect(lines()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ day: TOMORROW });
  });

  it("moves a line from another day to today, after today's lines", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "今天已有");
    const id = seedTask(api, "2026-10-01", "拖了好久");
    const { engine } = await renderApp({ api, hash: "#/day/2026-10-01" });
    openMenu();
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "明天" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "今天" }));
    expect(dataOf(engine, id).day).toBe(TODAY);
    expect(texts(engine)).toEqual(["今天已有", "拖了好久"]);
  });

  it("moves a line to a picked date", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "改天");
    const { engine } = await renderApp({ api });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "选日期…" }));
    const input = screen.getByLabelText("选择日期") as HTMLInputElement;
    expect(input.value).toBe(TODAY);
    fireEvent.change(input, { target: { value: "" } });
    expect(dataOf(engine, id).day).toBe(TODAY);
    fireEvent.change(input, { target: { value: "2026-10-20" } });
    expect(dataOf(engine, id).day).toBe("2026-10-20");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drags a line to another place after a long press", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "一");
    seedTask(api, TODAY, "二");
    const id = seedTask(api, TODAY, "三");
    const { engine, store } = await renderApp({ api });
    // Rows 30px tall, one under another.
    const rows = [...list().querySelectorAll<HTMLElement>("li[data-task-id]")];
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: i * 30,
          height: 30,
          bottom: i * 30 + 30,
          left: 0,
          right: 300,
          width: 300,
        }) as DOMRect;
    });
    const row = rowOf(line(2));
    fireEvent.pointerDown(row, { button: 0, clientX: 50, clientY: 75 });
    await wait(500);
    expect(row.className).toContain("shadow-lg");
    fireEvent.pointerMove(row, { clientX: 50, clientY: 10 });
    // The others slide down to make room above them.
    expect(rowOf(line(0)).style.transform).toBe("translateY(30px)");
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    expect(texts(engine)).toEqual(["三", "一", "二"]);
    // The click that ends the drag does not start editing.
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    await synced(store);
    expect(tasksOfDay(engine, TODAY)[0]?.id).toBe(id);
  });

  it("does not drag on a short press, or one that moves first (a scroll)", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "一");
    seedTask(api, TODAY, "二");
    const { engine } = await renderApp({ api });
    const row = rowOf(line(1));
    fireEvent.pointerDown(row, { button: 0, clientX: 50, clientY: 45 });
    fireEvent.pointerMove(row, { clientX: 50, clientY: 5 });
    await wait(500);
    fireEvent.pointerUp(row);
    expect(row.className).not.toContain("shadow-lg");
    expect(texts(engine)).toEqual(["一", "二"]);
  });

  it("deletes a line", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "不要了");
    const { engine, store } = await renderApp({ api });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    expect(engine.get("task", id)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await synced(store);
    expect(api.data("task", id)).toBeNull();
  });

  it("opens on right click, but not on text being edited", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "右键");
    const { engine } = await renderApp({ api });
    act(() => line(0).focus());
    fireEvent.contextMenu(line(0));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => line(0).blur());
    fireEvent.contextMenu(rowOf(line(0)));
    expect(screen.getByRole("dialog", { name: "右键" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    const box = screen.getByRole("button", { name: "标为完成" });
    fireEvent.contextMenu(box);
    expect(screen.getByRole("dialog", { name: "右键" })).toBeTruthy();
    // A right click on the box opens the menu and does not tick the line.
    expect(dataOf(engine, id).done).toBe(false);
  });

  it("lifts the line on a long press on its box, without ticking or opening the menu", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "长按");
    const { engine } = await renderApp({ api });
    const box = screen.getByRole("button", { name: "标为完成" });
    fireEvent.pointerDown(box, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(box, { clientX: 12, clientY: 11 });
    await wait(550);
    expect(rowOf(line(0)).className).toContain("shadow-lg");
    fireEvent.pointerUp(box);
    fireEvent.click(box);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dataOf(engine, id).done).toBe(false);
  });

  it("treats a press that moves or is cancelled as a tap", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "滑动");
    const { engine } = await renderApp({ api });
    const box = screen.getByRole("button", { name: "标为完成" });
    fireEvent.pointerDown(box, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(box, { clientX: 40, clientY: 10 });
    await wait(550);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(box);
    expect(dataOf(engine, id).done).toBe(true);

    const undo = screen.getByRole("button", { name: "标为未完成" });
    fireEvent.pointerDown(undo, { clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(undo);
    await wait(550);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TodayPage toolbar", () => {
  const tool = (name: string) => within(toolbar()).getByRole("button", { name });
  const picture = (name = "a.png") => new File(["png"], name, { type: "image/png" });
  const pick = (files: File[]) =>
    fireEvent.change(screen.getByLabelText("添加图片"), { target: { files } });

  it("shows while a line is edited and goes when it is left", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "一行");
    await renderApp({ api });
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => line(0).focus());
    expect(toolbar()).toBeTruthy();
    expect(tool("待办").getAttribute("aria-pressed")).toBe("true");
    // Pressing a tool does not take the caret out of the line.
    const down = createEvent.pointerDown(tool("缩进"));
    fireEvent(tool("缩进"), down);
    expect(down.defaultPrevented).toBe(true);
    act(() => line(0).blur());
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("turns a line into a dot or dash note and back", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "想法", { done: true, duration: 20 });
    const { engine, store } = await renderApp({ api });
    act(() => line(0).focus());
    fireEvent.click(tool("圆点"));
    expect(dataOf(engine, id)).toMatchObject({ mark: "dot", done: false, duration: null });
    expect(tool("圆点").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "圆点" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /标为/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /用时/ })).toBeNull();
    fireEvent.click(tool("横线"));
    expect(screen.getByRole("img", { name: "横线" })).toBeTruthy();
    fireEvent.click(tool("待办"));
    expect(screen.getByRole("button", { name: "标为完成" })).toBeTruthy();
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ mark: "box" });
  });

  it("gives the new line a kind and an indent before anything is typed", async () => {
    const { engine } = await renderApp();
    act(() => newLine().focus());
    expect((tool("退格") as HTMLButtonElement).disabled).toBe(true);
    expect((tool("高亮") as HTMLButtonElement).disabled).toBe(true);
    expect((tool("图片") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tool("横线"));
    fireEvent.click(tool("缩进"));
    fireEvent.click(tool("缩进"));
    fireEvent.click(tool("退格"));
    type(newLine(), "一条随手记");
    press(newLine(), "Enter");
    const [task] = tasksOfDay(engine, TODAY);
    expect(task?.data).toMatchObject({ text: "一条随手记", mark: "dash", indent: 1 });
    // The next line keeps going the same way.
    act(() => newLine().focus());
    expect(tool("横线").getAttribute("aria-pressed")).toBe("true");
  });

  it("indents and outdents a line", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "缩进我");
    const { engine } = await renderApp({ api });
    act(() => line(0).focus());
    fireEvent.click(tool("缩进"));
    fireEvent.click(tool("缩进"));
    expect(dataOf(engine, id).indent).toBe(2);
    fireEvent.click(tool("退格"));
    expect(dataOf(engine, id).indent).toBe(1);
    expect(document.activeElement).toBe(line(0));
  });

  it("highlights with a fill or a coloured underline", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "重点");
    const { engine, store } = await renderApp({ api });
    act(() => line(0).focus());
    fireEvent.click(tool("高亮"));
    const colours = screen.getByRole("group", { name: "高亮颜色" });
    expect(
      within(colours).getByRole("button", { name: "不高亮" }).getAttribute("aria-pressed")
    ).toBe("true");
    fireEvent.click(within(colours).getByRole("button", { name: "黄色" }));
    expect(dataOf(engine, id)).toMatchObject({ highlight: "yellow" });
    expect(list().querySelector(".hl-yellow")).not.toBeNull();
    fireEvent.click(within(colours).getByRole("button", { name: "下划线" }));
    expect(dataOf(engine, id)).toMatchObject({ highlight: "yellow", highlightStyle: "underline" });
    expect(list().querySelector(".hl-u.hl-yellow")).not.toBeNull();
    fireEvent.click(within(colours).getByRole("button", { name: "蓝色" }));
    expect(dataOf(engine, id)).toMatchObject({ highlight: "blue", highlightStyle: "underline" });
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ highlight: "blue", highlightStyle: "underline" });
    fireEvent.click(within(colours).getByRole("button", { name: "不高亮" }));
    expect(dataOf(engine, id).highlight).toBeNull();
  });

  it("highlights what is typed on the new line by making it a line first", async () => {
    const { engine } = await renderApp();
    type(newLine(), "刚写的");
    fireEvent.click(tool("高亮"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "高亮颜色" })).getByRole("button", { name: "红色" })
    );
    const [task] = tasksOfDay(engine, TODAY);
    expect(task?.data).toMatchObject({ text: "刚写的", highlight: "red" });
  });

  it("puts a # at the caret and offers the tags she has", async () => {
    const api = createFakeApi();
    seedTask(api, YESTERDAY, "R 21-1-3 #阅读");
    seedTask(api, YESTERDAY, "思路 #大作文");
    const id = seedTask(api, TODAY, "复盘");
    const { engine } = await renderApp({ api, hash: "#/" });
    press(line(0), "End");
    fireEvent.click(tool("标签"));
    expect(line(0).value).toBe("复盘#");
    const tags = screen.getByLabelText("标签", { selector: "div" });
    expect(
      within(tags)
        .getAllByRole("button")
        .map((b) => b.textContent)
        .sort()
    ).toEqual(["#大作文", "#阅读"].sort());
    fireEvent.change(line(0), { target: { value: "复盘#阅", selectionStart: 4 } });
    act(() => line(0).setSelectionRange(4, 4));
    fireEvent.select(line(0));
    fireEvent.click(
      within(screen.getByLabelText("标签", { selector: "div" })).getByRole("button", {
        name: "#阅读",
      })
    );
    expect(line(0).value).toBe("复盘#阅读 ");
    act(() => line(0).blur());
    expect(dataOf(engine, id).text).toBe("复盘#阅读 ");
  });

  it("adds pictures to a line, shows them, and deletes one", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "看图");
    const { engine, store } = await renderApp({ api });
    act(() => line(0).focus());
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(tool("图片"));
    expect(click).toHaveBeenCalledTimes(1);
    pick([picture("a.png"), picture("b.png")]);
    await waitFor(() => expect(dataOf(engine, id).images).toHaveLength(2));
    expect(api.files.size).toBe(2);
    const [first, second] = dataOf(engine, id).images ?? [];
    const thumb = screen.getByRole("button", { name: "看第 2 张图片" });
    expect(thumb.querySelector("img")?.getAttribute("src")).toBe(`/api/v2/files/${second}`);

    fireEvent.click(thumb);
    const viewer = screen.getByRole("dialog", { name: "图片" });
    expect(within(viewer).getByText("2 / 2")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "上一张" }));
    expect(within(viewer).getByText("1 / 2")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: /删除图片/ }));
    fireEvent.click(within(viewer).getByRole("button", { name: "删除这张" }));
    expect(dataOf(engine, id).images).toEqual([second]);
    await waitFor(() => expect(api.files.has(first as string)).toBe(false));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ images: [second] });

    // A line with a picture stays when its words are cleared.
    type(line(0), "");
    act(() => line(0).blur());
    expect(engine.get("task", id)).not.toBeNull();
  });

  it("says so when the pictures cannot go up", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "没网");
    const { engine } = await renderApp({ api });
    act(() => line(0).focus());
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(tool("图片"));
    api.fail = "network";
    pick([picture()]);
    expect(await screen.findByText("没联网，图片传不上去")).toBeTruthy();
    expect(dataOf(engine, id).images ?? []).toEqual([]);
    api.fail = null;
    pick([new File(["gif"], "a.gif", { type: "image/gif" })]);
    expect(await screen.findByText("这张图片用不了，换一张试试")).toBeTruthy();
  });

  it("adds pictures to what is typed on the new line, up to nine a line", async () => {
    const { engine } = await renderApp();
    type(newLine(), "九张图");
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(tool("图片"));
    const [task] = tasksOfDay(engine, TODAY);
    expect(task?.data.text).toBe("九张图");
    pick(Array.from({ length: 10 }, (_, i) => picture(`${i}.png`)));
    expect(screen.getByText("一行最多放 9 张图片")).toBeTruthy();
    expect(screen.getAllByRole("status", { name: "图片上传中" }).length).toBeGreaterThan(0);
    await waitFor(() => expect(dataOf(engine, task?.id as string).images).toHaveLength(9));
    expect(screen.queryByRole("status", { name: "图片上传中" })).toBeNull();
  });

  it("says when the server would not keep a picture, and the notice goes after a while", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "坏了");
    await renderApp({ api });
    act(() => line(0).focus());
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(tool("图片"));
    api.fail = 500;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      pick([picture()]);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("图片没传上去，再试一次")).toBeTruthy();
      act(() => vi.advanceTimersByTime(3500));
      expect(screen.queryByText("图片没传上去，再试一次")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the caret where the line was tapped", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "复盘#阅读");
    await renderApp({ api });
    const copy = line(0).previousElementSibling as HTMLElement;
    const words = copy.querySelector("span") ?? copy;
    const first =
      [...words.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) ?? words.firstChild;
    const doc = document as unknown as Record<string, unknown>;
    doc.caretPositionFromPoint = () => ({ offsetNode: first, offset: 1 });
    try {
      fireEvent.click(rowOf(line(0)), { clientX: 30, clientY: 10 });
      expect(document.activeElement).toBe(line(0));
      expect(line(0).selectionStart).toBe(1);
    } finally {
      delete doc.caretPositionFromPoint;
    }
  });
});

describe("TodayPage carry-over from yesterday", () => {
  function seedYesterday() {
    const api = createFakeApi();
    const a = seedTask(api, YESTERDAY, "背单词 #英语");
    const b = seedTask(api, YESTERDAY, "练字", { indent: 1, highlight: "red" });
    seedTask(api, YESTERDAY, "做完的", { done: true });
    seedTask(api, YESTERDAY, "  ");
    return { api, a, b };
  }

  it("offers yesterday's unfinished lines and remembers 不用了", async () => {
    const { api } = seedYesterday();
    await renderApp({ api });
    expect(document.body.textContent).toContain("昨天还有 2 条没做完");
    fireEvent.click(screen.getByRole("button", { name: "不用了" }));
    expect(document.body.textContent).not.toContain("条没做完");
    expect(window.localStorage.getItem(`moli-todo:carry-dismissed:${TODAY}`)).toBe("1");

    cleanup();
    await renderApp({ api });
    expect(document.body.textContent).not.toContain("条没做完");
  });

  it("is not offered on another day", async () => {
    const { api } = seedYesterday();
    await renderApp({ api, hash: `#/day/${TOMORROW}` });
    expect(document.body.textContent).not.toContain("条没做完");
  });

  it("moves only the picked lines", async () => {
    const { api, a, b } = seedYesterday();
    const { engine, store } = await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "挑一挑" }));
    const sheet = screen.getByRole("dialog", { name: "挪到今天" });
    expect(sheet.textContent).toContain("背单词 #英语");
    expect(sheet.querySelector(".hl-red")).not.toBeNull();
    const boxes = within(sheet).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true]);
    fireEvent.click(boxes[1] as HTMLInputElement);
    expect(within(sheet).getByRole("button", { name: "挪 1 条到今天" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "挪 1 条到今天" }));

    expect(dataOf(engine, a).day).toBe(TODAY);
    expect(dataOf(engine, b).day).toBe(YESTERDAY);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(texts(engine)).toEqual(["背单词 #英语"]);
    expect(document.body.textContent).toContain("昨天还有 1 条没做完");
    await synced(store);
    expect(api.data("task", a)).toMatchObject({ day: TODAY });
    expect(api.data("task", b)).toMatchObject({ day: YESTERDAY });
  });

  it("moves them all and stops asking", async () => {
    const { api, a, b } = seedYesterday();
    const { engine } = await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "挑一挑" }));
    fireEvent.click(screen.getByRole("button", { name: "挪 2 条到今天" }));
    expect(dataOf(engine, a).day).toBe(TODAY);
    expect(dataOf(engine, b).day).toBe(TODAY);
    expect(document.body.textContent).not.toContain("条没做完");
    expect(window.localStorage.getItem(`moli-todo:carry-dismissed:${TODAY}`)).toBe("1");
  });

  it("cannot move nothing, and can be declined from the sheet", async () => {
    const { api } = seedYesterday();
    await renderApp({ api });
    fireEvent.click(screen.getByRole("button", { name: "挑一挑" }));
    const sheet = screen.getByRole("dialog", { name: "挪到今天" });
    for (const box of within(sheet).getAllByRole("checkbox")) fireEvent.click(box);
    expect(
      (within(sheet).getByRole("button", { name: "挪 0 条到今天" }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(within(sheet).getAllByRole("checkbox")[0] as HTMLElement);
    expect(
      (within(sheet).getByRole("button", { name: "挪 1 条到今天" }) as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).toContain("昨天还有 2 条没做完");

    fireEvent.click(screen.getByRole("button", { name: "挑一挑" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "不用了" }));
    expect(document.body.textContent).not.toContain("条没做完");
  });
});

describe("TodayPage leaving a day", () => {
  it("deletes blank lines left behind", async () => {
    const api = createFakeApi();
    const blank = seedTask(api, TODAY, "");
    const kept = seedTask(api, TODAY, "留着");
    const { engine, store } = await renderApp({ api });
    expect(lines()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    expect(engine.get("task", blank)).toBeNull();
    expect(engine.get("task", kept)).not.toBeNull();
    await synced(store);
    expect(api.data("task", blank)).toBeNull();
    expect(api.data("task", kept)).toMatchObject({ text: "留着" });
  });
});
