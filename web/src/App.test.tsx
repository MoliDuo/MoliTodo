import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { signInUrl } from "./api";
import { openLocalCache, type LocalCache } from "./lib/local-cache";
import { dayKey } from "./lib/time";
import { createFakeApi, ME } from "./test-support/fake-api";
import { renderApp, seedTask, TODAY } from "./test-support/render-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("shows today once signed in", async () => {
    const api = createFakeApi();
    window.history.replaceState(null, "", "#/");
    render(<App fetchFn={api.fetch} />);
    expect(await screen.findByRole("list", { name: "任务" })).toBeTruthy();
  });
});

describe("App on this device", () => {
  /** The app runs on the real clock here. */
  const today = () => dayKey(Date.now());

  /** A device that already has `text` for today, as the last session left it. */
  async function deviceWith(text: string, username = ME.username): Promise<LocalCache> {
    const api = createFakeApi();
    const taskId = seedTask(api, today(), text);
    const cache = openLocalCache(new IDBFactory());
    await cache.saveMe({ ...ME, username });
    const changes = (await (await api.fetch("/api/v2/changes?cursor=0")).json()) as {
      records: { kind: "task"; id: string; data: unknown; deleted: boolean; version: number }[];
      cursor: number;
    };
    const record = changes.records.find((r) => r.id === taskId)!;
    cache.saveState(username, {
      records: { [`task/${taskId}`]: record },
      pending: {},
      cursor: changes.cursor,
      conflicts: [],
      lastSyncAt: 1,
      loaded: true,
    });
    await cache.flush();
    return cache;
  }

  const taskList = async () => (await screen.findByRole("list", { name: "任务" })).textContent;

  it("opens from the copy on this device without the network", async () => {
    const cache = await deviceWith("离线也能看");
    const api = createFakeApi();
    api.fail = "network";
    window.history.replaceState(null, "", "#/");
    render(<App fetchFn={api.fetch} cache={cache} />);
    await waitFor(async () => expect(await taskList()).toContain("离线也能看"));
    expect(await screen.findByText("离线中，改动已保存在这里，联网后自动同步")).toBeTruthy();
  });

  it("still says so when the network is down and nothing is kept", async () => {
    const api = createFakeApi();
    api.fail = "network";
    render(<App fetchFn={api.fetch} cache={openLocalCache(new IDBFactory())} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("goes back through sign-in even with a copy on this device", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", assign });
    const cache = await deviceWith("别人看不到");
    const api = createFakeApi();
    api.fail = 401;
    render(<App fetchFn={api.fetch} cache={cache} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?next=%2F"));
  });

  it("keeps the copy of what the server sends, for next time", async () => {
    const cache = openLocalCache(new IDBFactory());
    const api = createFakeApi();
    seedTask(api, today(), "下次直接显示");
    window.history.replaceState(null, "", "#/");
    const view = render(<App fetchFn={api.fetch} cache={cache} />);
    await waitFor(async () => expect(await taskList()).toContain("下次直接显示"));
    view.unmount();
    await cache.flush();
    const saved = await cache.load();
    expect(saved?.me).toEqual(ME);
    expect(JSON.stringify(saved?.state?.records)).toContain("下次直接显示");
  });

  it("shows the copy first, then what changed on the server meanwhile", async () => {
    const cache = await deviceWith("本机已有");
    const api = createFakeApi();
    seedTask(api, today(), "本机已有");
    seedTask(api, today(), "别的设备新加");
    window.history.replaceState(null, "", "#/");
    render(<App fetchFn={api.fetch} cache={cache} />);
    await waitFor(async () => expect(await taskList()).toContain("别的设备新加"));
  });

  it("writes the copy at once when the page is hidden or closed", async () => {
    const cache = openLocalCache(new IDBFactory());
    const flush = vi.spyOn(cache, "flush");
    render(<App fetchFn={createFakeApi().fetch} cache={cache} />);
    window.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(1);
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("does nothing more once it is gone before the copy is read", async () => {
    const cache = await deviceWith("不会显示");
    const load = vi.spyOn(cache, "load");
    const view = render(<App fetchFn={createFakeApi().fetch} cache={cache} />);
    view.unmount();
    await load.mock.results[0]?.value;
    expect(screen.queryByRole("list", { name: "任务" })).toBeNull();
  });

  it("ignores a failed sign-in check that comes after it is gone", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", assign });
    const cache = openLocalCache(new IDBFactory());
    let answer: (response: Response) => void = () => {};
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    const view = render(<App fetchFn={fetchFn as unknown as typeof fetch} cache={cache} />);
    await cache.load();
    view.unmount();
    answer(new Response("{}", { status: 401 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(assign).not.toHaveBeenCalled();
  });

  it("switches to the signed-in person's own copy when someone else was here last", async () => {
    const cache = await deviceWith("bob 的任务", "bob");
    const api = createFakeApi();
    seedTask(api, today(), "alice 的任务");
    window.history.replaceState(null, "", "#/");
    render(<App fetchFn={api.fetch} cache={cache} />);
    await waitFor(async () => {
      const text = await taskList();
      expect(text).toContain("alice 的任务");
      expect(text).not.toContain("bob 的任务");
    });
    expect((await cache.load())?.me.username).toBe(ME.username);
  });
});

describe("signInUrl", () => {
  it("keeps the path and query as the place to return to", () => {
    expect(signInUrl({ pathname: "/", search: "" })).toBe("/auth/login?next=%2F");
  });
});

describe("Shell", () => {
  it("shows the day's tasks from the server", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "流程图类 #小作文", { done: true, duration: 45 });
    await renderApp({ api });
    const list = screen.getByRole("list", { name: "任务" });
    await waitFor(() => expect(list.textContent).toContain("流程图类 #小作文"));
    expect(list.textContent).toContain("45min");
  });
});
