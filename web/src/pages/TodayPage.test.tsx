import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("focuses the text when the space beside it is clicked", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "点我");
    await renderApp({ api });
    const box = line(0).parentElement?.parentElement as HTMLElement;
    fireEvent.click(box);
    expect(document.activeElement).toBe(line(0));
    act(() => line(0).blur());
    fireEvent.click(line(0).parentElement as HTMLElement);
    expect(document.activeElement).not.toBe(line(0));
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
  const openMenu = (index = 0) => {
    fireEvent.mouseDown(screen.getAllByRole("button", { name: "更多" })[index] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "更多" })[index] as HTMLElement);
  };

  it("sets and clears the highlight", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "重点");
    const { engine, store } = await renderApp({ api });
    openMenu();
    const sheet = screen.getByRole("dialog", { name: "重点" });
    expect(within(sheet).getByRole("button", { name: "不高亮" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    for (const name of ["黄色", "红色", "蓝色", "绿色", "紫色"]) {
      expect(within(sheet).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(within(sheet).getByRole("button", { name: "黄色" }));
    expect(dataOf(engine, id).highlight).toBe("yellow");
    expect(within(sheet).getByRole("button", { name: "黄色" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(list().querySelector(".hl-yellow")).not.toBeNull();
    await synced(store);
    expect(api.data("task", id)).toMatchObject({ highlight: "yellow" });

    fireEvent.click(within(sheet).getByRole("button", { name: "不高亮" }));
    expect(dataOf(engine, id).highlight).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("moves a line up and down", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "一");
    seedTask(api, TODAY, "二");
    seedTask(api, TODAY, "三");
    const { engine } = await renderApp({ api });

    openMenu(0);
    expect((screen.getByRole("button", { name: "上移" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "下移" }));
    expect(texts(engine)).toEqual(["二", "一", "三"]);
    fireEvent.click(screen.getByRole("button", { name: "下移" }));
    expect(texts(engine)).toEqual(["二", "三", "一"]);
    expect((screen.getByRole("button", { name: "下移" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "上移" }));
    expect(texts(engine)).toEqual(["二", "一", "三"]);
    fireEvent.click(screen.getByRole("button", { name: "上移" }));
    expect(texts(engine)).toEqual(["一", "二", "三"]);
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

  it("opens on right click, but not on the text itself", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "右键");
    const { engine } = await renderApp({ api });
    fireEvent.contextMenu(line(0));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.contextMenu(rowOf(line(0)));
    expect(screen.getByRole("dialog", { name: "右键" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    const box = screen.getByRole("button", { name: "标为完成" });
    fireEvent.contextMenu(box);
    expect(screen.getByRole("dialog", { name: "右键" })).toBeTruthy();
    // The click that follows a right click does not tick the line.
    fireEvent.click(box);
    expect(dataOf(engine, id).done).toBe(false);
  });

  it("opens on a long press without ticking", async () => {
    const api = createFakeApi();
    const id = seedTask(api, TODAY, "长按");
    const { engine } = await renderApp({ api });
    const box = screen.getByRole("button", { name: "标为完成" });
    fireEvent.pointerDown(box, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(box, { clientX: 12, clientY: 11 });
    await wait(550);
    fireEvent.pointerUp(box);
    fireEvent.click(box);
    expect(screen.getByRole("dialog", { name: "长按" })).toBeTruthy();
    expect(dataOf(engine, id).done).toBe(false);
    // A second right click while the press counts as fired does not open it twice.
    fireEvent.contextMenu(box);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
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
