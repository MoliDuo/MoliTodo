import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { fetchMe, UnauthorizedError } from "./api";
import { useApp } from "./context";
import { readLocal, useMediaQuery, writeLocal } from "./hooks";
import { Shell } from "./Shell";
import { createTodoStore } from "./store";
import { createFakeApi, ME } from "./test-support/fake-api";
import { NOW, renderApp, seedTask, TODAY } from "./test-support/render-app";

const RELOADED_AT_KEY = "moli-todo:reloaded-for-upgrade";

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

/** The shell straight away, without waiting for a sync that may never succeed. */
function renderShell(api: ReturnType<typeof createFakeApi>, hash = "#/timer") {
  window.history.replaceState(null, "", hash);
  const store = createTodoStore(api.fetch);
  const view = render(<Shell store={store} me={ME} clock={() => NOW} />);
  return { store, view };
}

/** `window.location` with `reload` and `assign` to watch. */
function stubLocation(hash = "#/timer") {
  const reload = vi.fn();
  const assign = vi.fn();
  vi.stubGlobal("location", {
    ...window.location,
    pathname: "/",
    search: "",
    hash,
    reload,
    assign,
  });
  return { reload, assign };
}

const changesCalls = (api: ReturnType<typeof createFakeApi>) =>
  api.requests.filter((r) => r.url.startsWith("/api/v2/changes")).length;

describe("Shell banners", () => {
  it("says it is offline when the network is down, and keeps working", async () => {
    const api = createFakeApi();
    api.fail = "network";
    const { store } = renderShell(api);
    expect(await screen.findByText("离线中，改动已保存在这里，联网后自动同步")).toBeTruthy();
    expect(store.engine.getStatus()).toBe("offline");

    api.fail = null;
    act(() => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(store.engine.getStatus()).toBe("idle"));
    expect(screen.queryByText("离线中，改动已保存在这里，联网后自动同步")).toBeNull();
  });

  it("reloads once for a new version, then only asks within five minutes", async () => {
    const { reload } = stubLocation();
    const api = createFakeApi();
    api.fail = 426;
    renderShell(api);
    expect(await screen.findByText("版本太旧，请刷新页面")).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(window.sessionStorage.getItem(RELOADED_AT_KEY))).toBeGreaterThan(0);

    // The same answer again (here after the page comes back into view): no second reload.
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(changesCalls(api)).toBe(2));
    await waitFor(() => expect(screen.getByText("版本太旧，请刷新页面")).toBeTruthy());
    cleanup();

    // A fresh page inside the gap does not reload either.
    renderShell(api);
    expect(await screen.findByText("版本太旧，请刷新页面")).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the gap has passed", async () => {
    const { reload } = stubLocation();
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now() - 6 * 60 * 1000));
    const api = createFakeApi();
    api.fail = 426;
    renderShell(api);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("does not reload when session storage is not available", async () => {
    const { reload } = stubLocation();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage off");
    });
    const api = createFakeApi();
    api.fail = 426;
    renderShell(api);
    expect(await screen.findByText("版本太旧，请刷新页面")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("goes to sign-in when the session is gone", async () => {
    const { assign } = stubLocation();
    const api = createFakeApi();
    api.fail = 401;
    renderShell(api);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?next=%2F"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Shell refresh", () => {
  it("pulls again when the page comes back into view, gets focus or goes online", async () => {
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/timer" });
    expect(changesCalls(api)).toBe(1);

    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(changesCalls(api)).toBe(2));
    await waitFor(() => expect(store.engine.getStatus()).toBe("idle"));

    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(changesCalls(api)).toBe(3));
    await waitFor(() => expect(store.engine.getStatus()).toBe("idle"));

    seedTask(api, TODAY, "别的设备写的");
    act(() => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(changesCalls(api)).toBe(4));
    await waitFor(() => expect(store.engine.all("task")).toHaveLength(1));
  });

  it("does not pull while the page is hidden", async () => {
    const api = createFakeApi();
    await renderApp({ api, hash: "#/timer" });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      act(() => void window.dispatchEvent(new Event("focus")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(changesCalls(api)).toBe(1);
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(document.visibilityState).toBe("visible");
  });
});

describe("Shell routes and theme", () => {
  it("shows each section's page and marks it in the navigation", async () => {
    const cases: [string, string][] = [
      ["#/", "今天"],
      ["#/index", "索引"],
      ["#/tag/阅读", "索引"],
      ["#/book", "本子"],
      ["#/timer", "计时"],
      ["#/timer/stats", "计时"],
      ["#/me", "我的"],
    ];
    for (const [hash, section] of cases) {
      await renderApp({ hash });
      const nav = screen.getByRole("navigation", { name: "主导航" });
      const current = nav.querySelector('[aria-current="page"]');
      expect(current?.getAttribute("aria-label"), hash).toBe(section);
      cleanup();
    }
  });

  it("follows a dark system setting", async () => {
    let listener: (() => void) | null = null;
    let dark = true;
    const removeEventListener = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: dark,
        media: query,
        addEventListener: (_: string, fn: () => void) => {
          listener = fn;
        },
        removeEventListener,
      }))
    );
    await renderApp({ hash: "#/me" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");

    dark = false;
    act(() => listener?.());
    expect(document.documentElement.dataset.theme).toBe("light");
    cleanup();
    expect(removeEventListener).toHaveBeenCalled();
  });
});

describe("App", () => {
  it("uses the browser's fetch when none is given", async () => {
    const api = createFakeApi();
    vi.stubGlobal("fetch", api.fetch);
    window.history.replaceState(null, "", "#/me");
    render(<App />);
    expect(screen.getByText("加载中…")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Alice" })).toBeTruthy();
    await waitFor(() => expect(changesCalls(api)).toBeGreaterThan(0));
  });

  it("says loading failed when the network is down before sign-in is known", async () => {
    const api = createFakeApi();
    api.fail = "network";
    render(<App fetchFn={api.fetch} />);
    expect((await screen.findByRole("alert")).textContent).toBe("加载失败，请刷新页面重试。");
    expect(api.requests.map((r) => r.url)).toEqual(["/api/v1/me"]);
  });

  it("ignores an answer that comes after it is gone", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", assign });
    let answer: (response: Response) => void = () => {};
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    );
    const first = render(<App fetchFn={fetchFn as unknown as typeof fetch} />);
    first.unmount();
    answer(new Response(JSON.stringify(ME), { status: 200 }));

    const second = render(<App fetchFn={fetchFn as unknown as typeof fetch} />);
    second.unmount();
    answer(new Response("{}", { status: 401 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("fetchMe", () => {
  it("uses the browser's fetch by default", async () => {
    const api = createFakeApi();
    vi.stubGlobal("fetch", api.fetch);
    await expect(fetchMe()).resolves.toEqual(ME);
    expect(api.requests[0]?.url).toBe("/api/v1/me");
  });

  it("throws UnauthorizedError for 401 and a plain error otherwise", async () => {
    const api = createFakeApi();
    api.fail = 401;
    await expect(fetchMe(api.fetch)).rejects.toBeInstanceOf(UnauthorizedError);
    api.fail = 503;
    await expect(fetchMe(api.fetch)).rejects.toThrow("request failed: 503");
  });
});

describe("createTodoStore", () => {
  it("talks to the browser's fetch by default and tells listeners about changes", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "一件事");
    vi.stubGlobal("fetch", api.fetch);
    const store = createTodoStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();
    await store.engine.sync();
    expect(store.getSnapshot()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
    expect(store.engine.all("task")).toHaveLength(1);
    expect(api.requests[0]?.headers["x-moli-client"]).toBe("todo-web/0.0.0-test");

    unsubscribe();
    listener.mockClear();
    store.engine.put("settings", "settings", { accent: null, theme: "dark", cover: "monet" });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useApp", () => {
  it("throws outside the app", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useApp())).toThrow("useApp outside AppContext");
  });
});

describe("hooks", () => {
  it("reads and writes values kept in this browser", () => {
    writeLocal("moli-test", "1");
    expect(readLocal("moli-test")).toBe("1");
    window.localStorage.removeItem("moli-test");
    expect(readLocal("moli-test")).toBeNull();
  });

  it("does without local storage when it throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage off");
    });
    expect(readLocal("moli-test")).toBeNull();
    expect(() => writeLocal("moli-test", "1")).not.toThrow();
  });

  it("answers false for a media query without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result, unmount } = renderHook(() => useMediaQuery("(prefers-color-scheme: dark)"));
    expect(result.current).toBe(false);
    unmount();
  });
});
