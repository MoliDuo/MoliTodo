import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi } from "../test-support/fake-api";
import { renderApp, seedTask, synced, TODAY } from "../test-support/render-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const hashOf = (tag: string) => `#/tag/${encodeURIComponent(tag)}`;
const progress = () => screen.getByRole("progressbar", { name: "完成比例" });
const openSettings = () => {
  fireEvent.click(screen.getByRole("button", { name: "标签设置" }));
  return screen.getByRole("dialog");
};

function seedReading(api: ReturnType<typeof createFakeApi>) {
  seedTask(api, "2026-10-02", "R 20-1 #阅读", { done: true, duration: 40 });
  seedTask(api, "2026-10-02", "复盘", { indent: 1, done: true, duration: 20 });
  seedTask(api, "2026-10-02", "跑步");
  seedTask(api, TODAY, "R 20-2 #阅读");
  seedTask(api, TODAY, "R 20-3 #阅读", { done: true });
}

describe("TagPage", () => {
  it("counts the tag's tasks, time and share done", async () => {
    const api = createFakeApi();
    seedReading(api);
    await renderApp({ api, hash: hashOf("阅读") });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("#阅读");
    const main = screen.getByRole("main");
    expect(main.textContent).toContain("4 条");
    expect(main.textContent).toContain("共用时 1h");
    expect(main.textContent).toContain("完成 3");
    expect(main.textContent).toContain("未完成 1");
    expect(main.textContent).not.toContain("跑步");
    expect(progress().getAttribute("aria-valuenow")).toBe("75");
    expect((progress().firstElementChild as HTMLElement).style.width).toBe("75%");
  });

  it("puts the newest day first, keeps list order inside a day, and totals each day", async () => {
    const api = createFakeApi();
    seedReading(api);
    await renderApp({ api, hash: hashOf("阅读") });
    const sections = screen.getByRole("main").querySelectorAll("section");
    const groups = [...sections].slice(1) as HTMLElement[];
    expect(groups.map((g) => within(g).getAllByRole("button")[0]?.textContent)).toEqual([
      "10月4日 周日",
      "10月2日 周五",
    ]);
    expect(groups[0]?.textContent).toContain("R 20-2 #阅读");
    expect(groups[0]?.textContent?.indexOf("R 20-2")).toBeLessThan(
      groups[0]?.textContent?.indexOf("R 20-3") ?? 0
    );
    expect(groups[0]?.querySelector(".font-serif")).toBeNull();
    expect(groups[1]?.querySelector("span.font-serif")?.textContent).toBe("1h");
    expect(groups[1]?.textContent).toContain("复盘");
  });

  it("opens a day from its heading or one of its tasks", async () => {
    const api = createFakeApi();
    seedReading(api);
    await renderApp({ api, hash: hashOf("阅读") });
    fireEvent.click(screen.getByRole("button", { name: "10月2日 周五" }));
    expect(window.location.hash).toBe("#/day/2026-10-02");
    cleanup();
    await renderApp({ api, hash: hashOf("阅读") });
    fireEvent.click(screen.getByRole("button", { name: "10月4日 周日" }));
    expect(window.location.hash).toBe("#/");
    cleanup();
    await renderApp({ api, hash: hashOf("阅读") });
    fireEvent.click(screen.getByRole("button", { name: /^复盘/ }));
    expect(window.location.hash).toBe("#/day/2026-10-02");
    cleanup();
    await renderApp({ api, hash: hashOf("阅读") });
    fireEvent.click(screen.getByRole("button", { name: /^R 20-2/ }));
    expect(window.location.hash).toBe("#/");
  });

  it("uses the tag's own colour", async () => {
    const api = createFakeApi();
    seedReading(api);
    api.remote("tag", "阅读", { name: "阅读", color: "#3f7d5c" });
    await renderApp({ api, hash: hashOf("阅读") });
    expect((progress().firstElementChild as HTMLElement).style.background).toBe("rgb(63, 125, 92)");
  });

  it("says so when no task has the tag", async () => {
    await renderApp({ hash: hashOf("空") });
    expect(screen.getByText("没有写着 #空 的任务")).toBeTruthy();
    expect(progress().getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByRole("main").textContent).toContain("共用时 0min");
  });

  it("goes back in history, or to the index when there is none", async () => {
    await renderApp({ hash: hashOf("阅读") });
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const length = vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe(hashOf("阅读"));
    length.mockReturnValue(1);
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/index");
  });
});

describe("TagPage settings", () => {
  it("closes without changes when the name stays the same", async () => {
    const api = createFakeApi();
    seedReading(api);
    const { store } = await renderApp({ api, hash: hashOf("阅读") });
    const dialog = openSettings();
    expect(dialog.getAttribute("aria-label")).toBe("#阅读");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标签名" }), {
      target: { value: " #阅读 " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "改名" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(Object.keys(store.engine.getState().pending)).toHaveLength(0);
  });

  it("refuses a name that cannot be a tag", async () => {
    const api = createFakeApi();
    seedReading(api);
    await renderApp({ api, hash: hashOf("阅读") });
    const dialog = openSettings();
    const input = within(dialog).getByRole("textbox", { name: "标签名" });
    fireEvent.change(input, { target: { value: "读 书" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(within(dialog).getByText("标签不能有空格、# 和标点")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "读书" } });
    expect(within(dialog).queryByText("标签不能有空格、# 和标点")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("renames the tag in every task and moves its colour", async () => {
    const api = createFakeApi();
    const first = seedTask(api, "2026-10-02", "R 20-1 #阅读 #晚上");
    const other = seedTask(api, "2026-10-02", "跑步 #运动");
    const second = seedTask(api, TODAY, "R 20-2#阅读");
    api.remote("tag", "阅读", { name: "阅读", color: "#3f7d5c" });
    const { store } = await renderApp({ api, hash: hashOf("阅读") });
    const dialog = openSettings();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标签名" }), {
      target: { value: "#Reading" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "改名" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#/tag/Reading");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("#Reading")
    );
    expect(screen.getByRole("main").textContent).toContain("2 条");
    await synced(store);
    expect((api.data("task", first) as { text: string }).text).toBe("R 20-1 #Reading #晚上");
    expect((api.data("task", second) as { text: string }).text).toBe("R 20-2#Reading");
    expect((api.data("task", other) as { text: string }).text).toBe("跑步 #运动");
    expect(api.data("tag", "阅读")).toBeNull();
    expect(api.data("tag", "reading")).toEqual({ name: "Reading", color: "#3f7d5c" });
  });

  it("asks before merging into a tag that already exists, and stays when told no", async () => {
    const api = createFakeApi();
    const reading = seedTask(api, TODAY, "R #阅读");
    seedTask(api, TODAY, "书 #读书");
    const { store } = await renderApp({ api, hash: hashOf("阅读") });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dialog = openSettings();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标签名" }), {
      target: { value: "读书" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "改名" }));
    expect(confirm).toHaveBeenCalledWith("已经有 #读书，合并到一起吗？");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(window.location.hash).toBe(hashOf("阅读"));
    expect(Object.keys(store.engine.getState().pending)).toHaveLength(0);
    expect((api.data("task", reading) as { text: string }).text).toBe("R #阅读");
  });

  it("merges into a tag that already exists when told yes", async () => {
    const api = createFakeApi();
    const reading = seedTask(api, TODAY, "R #阅读");
    seedTask(api, TODAY, "书 #读书");
    const { store } = await renderApp({ api, hash: hashOf("阅读") });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const replace = vi.spyOn(window.history, "replaceState");
    const dialog = openSettings();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标签名" }), {
      target: { value: "读书" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "改名" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe(hashOf("读书"));
    expect(replace).toHaveBeenCalledWith(null, "", hashOf("读书"));
    await waitFor(() => expect(screen.getByRole("main").textContent).toContain("2 条"));
    await synced(store);
    expect((api.data("task", reading) as { text: string }).text).toBe("R #读书");
  });

  it("does not ask when only the case changes", async () => {
    const api = createFakeApi();
    const task = seedTask(api, TODAY, "R #reading");
    api.remote("tag", "reading", { name: "reading", color: "#4466bb" });
    const { store } = await renderApp({ api, hash: "#/tag/reading" });
    const confirm = vi.spyOn(window, "confirm");
    const dialog = openSettings();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标签名" }), {
      target: { value: "Reading" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "改名" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/tag/Reading");
    await synced(store);
    expect((api.data("task", task) as { text: string }).text).toBe("R #Reading");
    expect(api.data("tag", "reading")).toEqual({ name: "Reading", color: "#4466bb" });
  });

  it("sets the colour from a preset, a code and the system picker, and clears it", async () => {
    const api = createFakeApi();
    seedReading(api);
    const { store } = await renderApp({ api, hash: hashOf("阅读") });
    const dialog = openSettings();
    const none = within(dialog).getByRole("button", { name: "跟主题色" });
    expect(none.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(dialog).getByRole("button", { name: "湖水" }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "湖水" }).getAttribute("aria-pressed")
      ).toBe("true")
    );
    expect(none.getAttribute("aria-pressed")).toBe("false");
    await synced(store);
    expect(api.data("tag", "阅读")).toEqual({ name: "阅读", color: "#2f7f8f" });
    expect((progress().firstElementChild as HTMLElement).style.background).toBe(
      "rgb(47, 127, 143)"
    );

    const code = within(dialog).getByRole("textbox", { name: "色号" });
    expect(code).toHaveProperty("value", "#2f7f8f");
    fireEvent.change(code, { target: { value: "#12345" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "用这个" }));
    expect(
      within(dialog).getByText("不是色号，要像 #a34e00 这样（6 位，0-9 和 a-f）")
    ).toBeTruthy();
    fireEvent.change(code, { target: { value: "#B04A6C" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "用这个" }));
    await synced(store);
    expect(api.data("tag", "阅读")).toEqual({ name: "阅读", color: "#b04a6c" });
    expect(within(dialog).getByRole("button", { name: "莓果" }).getAttribute("aria-pressed")).toBe(
      "true"
    );

    fireEvent.change(within(dialog).getByLabelText("取色器"), { target: { value: "#abcdef" } });
    await synced(store);
    expect(api.data("tag", "阅读")).toEqual({ name: "阅读", color: "#abcdef" });

    fireEvent.click(none);
    await synced(store);
    expect(api.data("tag", "阅读")).toEqual({ name: "阅读", color: null });
    await waitFor(() => expect(none.getAttribute("aria-pressed")).toBe("true"));
    expect(code).toHaveProperty("value", "");
  });

  it("closes with the close button", async () => {
    await renderApp({ hash: hashOf("阅读") });
    const dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
