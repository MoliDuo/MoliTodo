import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { signInUrl } from "./api";
import { createFakeApi } from "./test-support/fake-api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const content = (text: string, position: string, over: object = {}) => ({
  text,
  done: false,
  doneAt: null,
  archived: false,
  duration: 0,
  position,
  deleted: false,
  ...over,
});

async function open(api = createFakeApi()) {
  render(<App fetchFn={api.fetch} />);
  await screen.findByRole("status");
  return api;
}

/** jsdom has no DragEvent, so the drop position is put on the event by hand. */
function dropAt(element: HTMLElement, clientY: number) {
  const event = createEvent.drop(element);
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(element, event);
}

const puts = (api: ReturnType<typeof createFakeApi>) =>
  api.requests.filter((r) => r.method === "PUT");

describe("App sign-in", () => {
  it("goes back through sign-in when the session is gone", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/tasks", search: "?a=1", assign });
    const api = createFakeApi();
    api.fail = 401;
    render(<App fetchFn={api.fetch} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?next=%2Ftasks%3Fa%3D1"));
  });

  it("says so when the server fails", async () => {
    const api = createFakeApi();
    api.fail = 500;
    render(<App fetchFn={api.fetch} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("signInUrl", () => {
  it("keeps the path and query as the place to return to", () => {
    expect(signInUrl({ pathname: "/", search: "" })).toBe("/auth/login?next=%2F");
  });
});

describe("task list", () => {
  it("shows tasks from the server, in order, and the sync time", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("第二个", "W"));
    api.remote("aaaaaaaa-2", content("第一个", "V"));
    await open(api);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["第一个", "第二个"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/已同步 \d\d:\d\d/));
    expect(
      api.requests.find((r) => r.url.startsWith("/api/v1/tasks"))?.headers["x-moli-client"]
    ).toMatch(/^todo-web\//);
  });

  it("adds a task on Enter and sends it to the server", async () => {
    const api = await open();
    const input = screen.getByLabelText("添加任务");
    fireEvent.change(input, { target: { value: "写周报" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("写周报")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    expect(puts(api)[0]?.body).toMatchObject({ text: "写周报", done: false, baseVersion: 0 });
  });

  it("does not add on the Enter that picks a word in an input method, or when empty", async () => {
    const api = await open();
    const input = screen.getByLabelText("添加任务");
    fireEvent.change(input, { target: { value: "nihao" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(puts(api)).toHaveLength(0);
  });

  it("ticks a task done and back", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("买咖啡豆", "V"));
    await open(api);
    fireEvent.click(await screen.findByLabelText("标为完成"));
    expect(screen.getByLabelText("标为未完成")).toBeTruthy();
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.done).toBe(true));
    expect(api.rows.get("aaaaaaaa-1")?.doneAt).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("标为未完成"));
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.done).toBe(false));
  });

  it("edits text in place: Enter saves, Escape cancels, empty text is not saved", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("旧", "V"));
    await open(api);
    fireEvent.click(await screen.findByText("旧"));
    let input = screen.getByLabelText("修改任务");
    fireEvent.change(input, { target: { value: "新" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("新")).toBeTruthy();
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.text).toBe("新"));

    fireEvent.click(screen.getByText("新"));
    input = screen.getByLabelText("修改任务");
    fireEvent.change(input, { target: { value: "放弃" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("新")).toBeTruthy();

    fireEvent.click(screen.getByText("新"));
    input = screen.getByLabelText("修改任务");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(screen.getByText("新")).toBeTruthy();
  });

  it("deletes a task and tells the server it is deleted", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("删我", "V"));
    await open(api);
    fireEvent.click(await screen.findByLabelText("删除 删我"));
    expect(screen.queryByText("删我")).toBeNull();
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.deleted).toBe(true));
  });

  it("reorders by dragging: only the moved task is sent", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("甲", "V"));
    api.remote("aaaaaaaa-2", content("乙", "W"));
    api.remote("aaaaaaaa-3", content("丙", "X"));
    await open(api);
    const rows = await screen.findAllByRole("listitem");
    fireEvent.dragStart(rows[2] as HTMLElement);
    fireEvent.dragOver(rows[0] as HTMLElement);
    // A row has no size in jsdom, so a position above 0 is the lower half and below 0 the upper half.
    dropAt(rows[0] as HTMLElement, -1);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "丙",
        "甲",
        "乙",
      ])
    );
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    expect(puts(api)[0]?.url).toBe("/api/v1/tasks/aaaaaaaa-3");
    // Dropping on the lower half of a row puts the task after that row.
    const again = screen.getAllByRole("listitem");
    fireEvent.dragStart(again[0] as HTMLElement);
    dropAt(again[1] as HTMLElement, 5);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "甲",
        "丙",
        "乙",
      ])
    );
  });

  it("ignores a drop that is not a drag of ours, and dropping a task on itself", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("甲", "V"));
    api.remote("aaaaaaaa-2", content("乙", "W"));
    await open(api);
    const rows = await screen.findAllByRole("listitem");
    dropAt(rows[0] as HTMLElement, -1);
    fireEvent.dragStart(rows[0] as HTMLElement);
    dropAt(rows[0] as HTMLElement, -1);
    fireEvent.dragStart(rows[1] as HTMLElement);
    fireEvent.dragEnd(rows[1] as HTMLElement);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["甲", "乙"]);
    expect(puts(api)).toHaveLength(0);
  });

  it("clears finished tasks into the completed view", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("做完了", "V", { done: true, doneAt: Date.now() }));
    api.remote("aaaaaaaa-2", content("没做完", "W"));
    await open(api);
    fireEvent.click(await screen.findByText("清除已完成（1）"));
    expect(screen.queryByText("做完了")).toBeNull();
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.archived).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    expect(screen.getByText("做完了")).toBeTruthy();
    expect(screen.getByText("今天")).toBeTruthy();
  });
});

describe("completed view", () => {
  const done = (text: string, position: string, doneAt: number, over: object = {}) =>
    content(text, position, { done: true, doneAt, archived: true, ...over });

  async function openCompleted(api = createFakeApi()) {
    await open(api);
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    return api;
  }

  it("says when nothing is finished", async () => {
    await openCompleted();
    expect(screen.getByText("还没有完成的任务。")).toBeTruthy();
  });

  it("groups by day with the day's total, and shows the time", async () => {
    const api = createFakeApi();
    const now = Date.now();
    api.remote("aaaaaaaa-1", done("今天的", "V", now, { duration: 90 }));
    api.remote("aaaaaaaa-2", done("早先的", "W", now - 5 * 86_400_000));
    api.remote("aaaaaaaa-3", done("没时间的", "X", 0, { doneAt: null }));
    await openCompleted(api);
    const today = screen.getByRole("region", { name: "今天" });
    expect(within(today).getByText("1小时30分", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "完成时间未知" })).toBeTruthy();
    expect(screen.getByText("早先的")).toBeTruthy();
  });

  it("sets the time spent from text like 1h30m, and refuses text that is not a duration", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", done("写周报", "V", Date.now()));
    await openCompleted(api);
    fireEvent.click(await screen.findByLabelText("耗时 写周报"));
    let input = screen.getByLabelText("耗时");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByLabelText("耗时").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(screen.getByLabelText("耗时"), { target: { value: "1h30m" } });
    fireEvent.keyDown(screen.getByLabelText("耗时"), { key: "Enter" });
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.duration).toBe(90));
    expect(screen.getByLabelText("耗时 写周报").textContent).toBe("1小时30分");
    fireEvent.click(screen.getByLabelText("耗时 写周报"));
    input = screen.getByLabelText("耗时");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByLabelText("耗时 写周报")).toBeTruthy();
    // Leaving a bad value by clicking away drops it.
    fireEvent.click(screen.getByLabelText("耗时 写周报"));
    fireEvent.change(screen.getByLabelText("耗时"), { target: { value: "zzz" } });
    fireEvent.keyDown(screen.getByLabelText("耗时"), { key: "Enter" });
    fireEvent.blur(screen.getByLabelText("耗时"));
    expect(screen.getByLabelText("耗时 写周报").textContent).toBe("1小时30分");
  });

  it("changes the completion day, keeping the time of day and never going into the future", async () => {
    const api = createFakeApi();
    const doneAt = Date.now() - 60_000;
    api.remote("aaaaaaaa-1", done("改日期", "V", doneAt));
    await openCompleted(api);
    const field = await screen.findByLabelText("完成日期 改日期");
    fireEvent.change(field, { target: { value: "2026-01-02" } });
    await waitFor(() => {
      const moved = api.rows.get("aaaaaaaa-1")?.doneAt ?? 0;
      expect(moved).toBeLessThan(doneAt - 86_400_000);
    });
    fireEvent.change(screen.getByLabelText("完成日期 改日期"), { target: { value: "" } });
  });

  it("deletes a finished task", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", done("删掉", "V", Date.now()));
    await openCompleted(api);
    fireEvent.click(await screen.findByLabelText("删除 删掉"));
    await waitFor(() => expect(api.rows.get("aaaaaaaa-1")?.deleted).toBe(true));
  });
});

describe("sync", () => {
  it("keeps changes made while offline and sends them when the network is back", async () => {
    const api = await open();
    api.fail = "network";
    const input = screen.getByLabelText("添加任务");
    fireEvent.change(input, { target: { value: "离线写的" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/离线/));
    expect(screen.getByText("离线写的")).toBeTruthy();
    api.fail = null;
    fireEvent.click(screen.getByTitle("立即同步"));
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/已同步/));
  });

  it("shows a conflict, keeps the server's version, and lets the person dismiss it", async () => {
    const api = createFakeApi();
    api.remote("aaaaaaaa-1", content("原文", "V"));
    await open(api);
    await screen.findByText("原文");
    // Another device changes it; this tab still has the old version and edits it.
    api.remote("aaaaaaaa-1", content("别处改的", "V"));
    fireEvent.click(screen.getByText("原文"));
    const input = screen.getByLabelText("修改任务");
    fireEvent.change(input, { target: { value: "我改的" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("别处改的", { selector: "li > span, button" })).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("我改的")).toBeTruthy();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fireEvent.click(within(alert).getByText("复制"));
    expect(writeText).toHaveBeenCalledWith("我改的");
    fireEvent.click(within(alert).getByText("忽略"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reloads once when the app is too old, then asks, and signs in again when the session ends", async () => {
    window.sessionStorage.clear();
    const api = await open();
    const reload = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", assign, reload });
    api.fail = 426;
    fireEvent.click(screen.getByTitle("立即同步"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // The page is still the old one (the reload was faked): no second reload right after the first.
    api.fail = null;
    fireEvent.click(screen.getByTitle("立即同步"));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toMatch(/版本太旧/));
    api.fail = 426;
    fireEvent.click(screen.getByTitle("立即同步"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/版本太旧/));
    expect(reload).toHaveBeenCalledTimes(1);
    api.fail = 401;
    fireEvent.click(screen.getByTitle("立即同步"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?next=%2F"));
  });

  it("pulls again when the tab becomes visible", async () => {
    const api = await open();
    const before = api.requests.filter((r) => r.url.startsWith("/api/v1/tasks/changes")).length;
    api.remote("aaaaaaaa-9", content("别处加的", "V"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("别处加的")).toBeTruthy();
    expect(
      api.requests.filter((r) => r.url.startsWith("/api/v1/tasks/changes")).length
    ).toBeGreaterThan(before);
  });
});

describe("settings and import", () => {
  const oldFile = (tasks: unknown[]) =>
    new File([JSON.stringify({ tasks })], "store.json", { type: "application/json" });

  async function openSettings(api = createFakeApi()) {
    await open(api);
    fireEvent.click(screen.getByLabelText("设置"));
    return api;
  }

  it("shows the account and closes", async () => {
    await openSettings();
    expect(screen.getByRole("dialog").textContent).toContain("Alice");
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("imports old tasks once, skips them the second time, and adds only the new ones the third time", async () => {
    const api = await openSettings();
    const pick = (file: File) =>
      fireEvent.change(screen.getByLabelText("选择 store.json"), { target: { files: [file] } });
    const old = [
      { id: 1, text: "旧任务一", done: false },
      { id: 2, text: "旧任务二", done: true, doneAt: 1_700_000_000_000, duration: 30 },
    ];
    pick(oldFile(old));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
        "导入 2 条，跳过 0 条（之前导入过）。"
      )
    );
    expect(puts(api)).toHaveLength(2);
    pick(oldFile(old));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
        "导入 0 条，跳过 2 条（之前导入过）。"
      )
    );
    expect(puts(api)).toHaveLength(2);
    pick(oldFile([...old, { id: 3, text: "新增的", done: false }, { id: 4, text: "" }]));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
        "导入 1 条，跳过 2 条（之前导入过），1 条无法识别。"
      )
    );
    expect(puts(api)).toHaveLength(3);
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.getByText("旧任务一")).toBeTruthy();
    expect(screen.getByText("新增的")).toBeTruthy();
  });

  it("does not bring back an imported task that was deleted afterwards", async () => {
    const api = await openSettings();
    const pick = (file: File) =>
      fireEvent.change(screen.getByLabelText("选择 store.json"), { target: { files: [file] } });
    const old = [{ id: 1, text: "会被删", done: false }];
    pick(oldFile(old));
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toMatch(
        /导入 1 条/
      )
    );
    fireEvent.click(screen.getByLabelText("关闭"));
    fireEvent.click(screen.getByLabelText("删除 会被删"));
    await waitFor(() => expect([...api.rows.values()][0]?.deleted).toBe(true));
    fireEvent.click(screen.getByLabelText("设置"));
    pick(oldFile(old));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe(
        "导入 0 条，跳过 1 条（之前导入过）。"
      )
    );
  });

  it("refuses a file that is not a task file", async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText("选择 store.json"), {
      target: { files: [new File(["{not json"], "x.json")] },
    });
    expect((await within(screen.getByRole("dialog")).findByRole("status")).textContent).toContain(
      "不是哞哞清单的任务文件"
    );
  });

  it("reports a failure to read the file", async () => {
    await openSettings();
    const broken = { text: () => Promise.reject(new Error("unreadable")) } as unknown as File;
    fireEvent.change(screen.getByLabelText("选择 store.json"), { target: { files: [broken] } });
    expect((await screen.findByText("导入失败，请重试。")).tagName).toBe("P");
  });
});
