import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionData, TimerData } from "@shared/records";
import { createFakeApi } from "../test-support/fake-api";
import { NOW, renderApp, seedSession, seedTask, synced, TODAY } from "../test-support/render-app";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A clock the test moves by hand. */
function movableClock(start = NOW) {
  let t = start;
  return {
    clock: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

const stopwatch = () => screen.getByRole("timer", { name: "已计时" }).textContent;
const picker = () => screen.getByRole("button", { name: /点此可更换专注任务/ });
const savedSessions = (api: ReturnType<typeof createFakeApi>) =>
  [...api.rows.values()]
    .filter((row) => row.kind === "session" && !row.deleted)
    .map((row) => row.data as SessionData);
/** Lets `useNow` read the clock again, as when the page comes back into view. */
const lookAgain = () => act(() => void document.dispatchEvent(new Event("visibilitychange")));

describe("TimerPage name picker", () => {
  it("offers today's written tasks without their tags, and recent names", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "R 21-1-3 #阅读", { indent: 1, done: true });
    seedTask(api, TODAY, "   ");
    seedTask(api, TODAY, "#只有标签");
    seedTask(api, "2026-10-03", "昨天的事");
    seedSession(api, "单词", "2026-10-02", 600);
    seedSession(api, "小作文", "2026-10-01", 600);
    seedSession(api, "单词", "2026-09-30", 600);
    const { store } = await renderApp({ api, hash: "#/timer" });

    expect(picker().textContent).toContain("选一个专注任务");
    fireEvent.click(picker());
    const dialog = screen.getByRole("dialog", { name: "专注什么" });
    const tasks = within(dialog).getByText("今天的任务").closest("section") as HTMLElement;
    const names = within(tasks)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["R 21-1-3", "#只有标签"]);
    const recent = within(dialog).getByText("最近用过").closest("section") as HTMLElement;
    expect(
      within(recent)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["单词", "小作文"]);

    fireEvent.click(within(tasks).getByRole("button", { name: "R 21-1-3" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(picker().textContent).toContain("R 21-1-3");

    fireEvent.click(picker());
    fireEvent.click(screen.getByRole("button", { name: "小作文" }));
    expect(picker().textContent).toContain("小作文");

    fireEvent.click(picker());
    const input = screen.getByRole("textbox", { name: "专注任务名" }) as HTMLInputElement;
    expect(input.value).toBe("小作文");
    fireEvent.change(input, { target: { value: "  背单词  " } });
    fireEvent.click(screen.getByRole("button", { name: "好" }));
    expect(picker().textContent).toContain("背单词");

    await synced(store);
    expect((api.data("timer", "current") as TimerData).name).toBe("背单词");
  });

  it("closes without changing the name, and has no lists when there is nothing to offer", async () => {
    await renderApp({ hash: "#/timer" });
    fireEvent.click(picker());
    const dialog = screen.getByRole("dialog", { name: "专注什么" });
    expect(within(dialog).queryByText("今天的任务")).toBeNull();
    expect(within(dialog).queryByText("最近用过")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(picker());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(picker().textContent).toContain("选一个专注任务");
  });
});

describe("TimerPage stopwatch", () => {
  it("starts, advances with the clock, pauses, resumes and saves a session", async () => {
    const { clock, advance } = movableClock();
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/timer", clock });
    expect(stopwatch()).toBe("00:00");
    expect(screen.getByText(/今天已专注/).textContent).toBe("今天已专注 0分钟");
    expect(screen.queryByRole("button", { name: "结束" })).toBeNull();

    fireEvent.click(picker());
    fireEvent.change(screen.getByRole("textbox", { name: "专注任务名" }), {
      target: { value: "单词" },
    });
    fireEvent.submit(screen.getByRole("textbox", { name: "专注任务名" }));

    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    expect(screen.getByText("专注中")).toBeTruthy();
    expect(stopwatch()).toBe("00:00");

    advance(65_000);
    // The running stopwatch refreshes itself every quarter second.
    await waitFor(() => expect(stopwatch()).toBe("01:05"));

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(screen.getByText("已暂停")).toBeTruthy();
    advance(100_000);
    lookAgain();
    expect(stopwatch()).toBe("01:05");

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    advance(10_000);
    lookAgain();
    expect(stopwatch()).toBe("01:15");

    fireEvent.click(screen.getByRole("button", { name: "结束" }));
    expect(screen.getByRole("status").textContent).toBe("记下了 1分钟");
    expect(stopwatch()).toBe("00:00");
    expect(picker().textContent).toContain("单词");
    expect(screen.getByText(/今天已专注/).textContent).toBe("今天已专注 1分钟");

    await synced(store);
    expect(savedSessions(api)).toEqual([
      {
        name: "单词",
        startedAt: NOW,
        endedAt: NOW + 175_000,
        seconds: 75,
        day: TODAY,
      },
    ]);
    expect(api.data("timer", "current")).toEqual({
      name: "单词",
      startedAt: null,
      accumulated: 0,
      runningSince: null,
    });
  });

  it("does not keep a run under a minute, and the notice goes away", async () => {
    const { clock, advance } = movableClock();
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/timer", clock });
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    advance(30_000);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "结束" }));
    expect(screen.getByRole("status").textContent).toBe("不到 1 分钟，这次没记");
    act(() => void vi.advanceTimersByTime(3600));
    expect(screen.queryByRole("status")).toBeNull();
    vi.useRealTimers();

    await synced(store);
    expect(savedSessions(api)).toEqual([]);
  });

  it("names a session with no name 未命名", async () => {
    const { clock, advance } = movableClock();
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/timer", clock });
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    advance(2 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "结束" }));
    expect(screen.getByRole("status").textContent).toBe("记下了 2分钟");
    await synced(store);
    expect(savedSessions(api).map((s) => s.name)).toEqual(["未命名"]);
  });

  it("shows how long she has focused today", async () => {
    const api = createFakeApi();
    seedSession(api, "阅读", TODAY, 1800);
    seedSession(api, "单词", TODAY, 1500);
    seedSession(api, "旧的", "2026-10-03", 3600);
    await renderApp({ api, hash: "#/timer" });
    expect(screen.getByText(/今天已专注/).textContent).toBe("今天已专注 55分钟");
  });
});

describe("TimerPage restored from the server", () => {
  it("keeps running a stopwatch started on another device", async () => {
    const api = createFakeApi();
    api.remote("timer", "current", {
      name: "背单词",
      startedAt: NOW - 90_000,
      accumulated: 0,
      runningSince: NOW - 90_000,
    } satisfies TimerData);
    await renderApp({ api, hash: "#/timer" });
    await waitFor(() => expect(stopwatch()).toBe("01:30"));
    expect(picker().textContent).toContain("背单词");
    expect(screen.getByText("专注中")).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "结束" })).toBeTruthy();
  });

  it("shows a paused run of more than an hour", async () => {
    const api = createFakeApi();
    api.remote("timer", "current", {
      name: "",
      startedAt: NOW - 2 * 3600_000,
      accumulated: 3725,
      runningSince: null,
    } satisfies TimerData);
    await renderApp({ api, hash: "#/timer" });
    await waitFor(() => expect(stopwatch()).toBe("1:02:05"));
    expect(screen.getByText("已暂停")).toBeTruthy();
    expect(screen.getByRole("button", { name: "继续" })).toBeTruthy();
  });
});

describe("TimerPage header", () => {
  it("goes to the statistics", async () => {
    await renderApp({ hash: "#/timer" });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    expect(window.location.hash).toBe("#/timer/stats");
    expect(await screen.findByRole("heading", { name: "统计" })).toBeTruthy();
  });
});
