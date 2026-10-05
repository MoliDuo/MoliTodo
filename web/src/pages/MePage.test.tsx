import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionData, SettingsData, TaskData } from "@shared/records";
import { Shell } from "../Shell";
import { createTodoStore } from "../store";
import { createFakeApi, ME } from "../test-support/fake-api";
import { NOW, renderApp, seedSession, seedTask, synced, TODAY } from "../test-support/render-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const syncLine = () => within(screen.getByRole("main")).getByRole("status");
const syncText = () => syncLine().textContent;
const savedSettings = (api: ReturnType<typeof createFakeApi>) =>
  api.data("settings", "settings") as SettingsData | null;
const accentVar = () => document.body.style.getPropertyValue("--moli-accent");

describe("MePage header", () => {
  it("shows her name and initial, and when it last synced", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    await renderApp({ hash: "#/me" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Alice");
    expect(screen.getByText("A")).toBeTruthy();
    expect(syncText()).toBe("已同步 21:30");
    expect(screen.getByText("Moli Todo 0.0.0-test")).toBeTruthy();
  });

  it("writes the day of the last sync when it was not today", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW - 2 * 24 * 3600_000);
    await renderApp({ hash: "#/me" });
    expect(syncText()).toBe("已同步 10月2日 周五 21:30");
  });

  it("uses the user name when there is no display name, and says when it has never synced", async () => {
    window.history.replaceState(null, "", "#/me");
    const store = createTodoStore((() => new Promise(() => {})) as typeof fetch);
    render(<Shell store={store} me={{ ...ME, name: null }} clock={() => NOW} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("alice");
    expect(screen.getByText("A")).toBeTruthy();
    expect(syncText()).toBe("还没同步过");
    expect((screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("counts changes waiting to be sent, offline or not, and syncs on demand", async () => {
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/me" });
    fireEvent.click(screen.getByRole("radio", { name: "深色" }));
    expect(syncText()).toBe("1 处改动正在同步");
    await synced(store);

    api.fail = "network";
    const button = screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
    await waitFor(() => expect(syncText()).toBe("离线中，0 处改动等联网后同步"));
    expect(syncLine().parentElement?.querySelector(".lucide-cloud-off")).toBeTruthy();
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.click(screen.getByRole("radio", { name: "浅色" }));
    expect(syncText()).toBe("离线中，1 处改动等联网后同步");

    api.fail = null;
    fireEvent.click(button);
    await synced(store);
    await waitFor(() => expect(syncText()).toMatch(/^已同步/));
    expect(savedSettings(api)?.theme).toBe("light");
  });
});

describe("MePage appearance", () => {
  it("saves the theme colour: a preset, the default (as none) and a typed code", async () => {
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/me" });
    // The case colour has the same swatches; these are the theme colour's.
    const theme = within(
      screen.getByRole("heading", { name: "主题色" }).closest("section") as HTMLElement
    );
    const amber = theme.getByRole("button", { name: "琥珀" });
    expect(amber.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(theme.getByRole("button", { name: "湖水" }));
    expect(theme.getByRole("button", { name: "湖水" }).getAttribute("aria-pressed")).toBe("true");
    expect(accentVar()).toBe("#2f7f8f");
    await synced(store);
    expect(savedSettings(api)).toEqual({ accent: "#2f7f8f", theme: "system", cover: "monet" });

    fireEvent.click(amber);
    expect(accentVar()).toBe("#a34e00");
    await synced(store);
    expect(savedSettings(api)?.accent).toBeNull();

    fireEvent.change(theme.getByRole("textbox", { name: "色号" }), {
      target: { value: "#123456" },
    });
    fireEvent.click(theme.getByRole("button", { name: "用这个" }));
    expect(accentVar()).toBe("#123456");
    expect(document.body.style.getPropertyValue("--moli-accent-fg")).toBe("#ffffff");
    await synced(store);
    expect(savedSettings(api)?.accent).toBe("#123456");
  });

  it("saves light, dark or system appearance", async () => {
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/me" });
    const radios = within(screen.getByRole("radiogroup", { name: "外观" }));
    expect(radios.getByRole("radio", { name: "跟随系统" }).getAttribute("aria-checked")).toBe(
      "true"
    );

    fireEvent.click(radios.getByRole("radio", { name: "深色" }));
    expect(radios.getByRole("radio", { name: "深色" }).getAttribute("aria-checked")).toBe("true");
    expect(radios.getByRole("radio", { name: "跟随系统" }).getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    await synced(store);
    expect(savedSettings(api)?.theme).toBe("dark");

    fireEvent.click(radios.getByRole("radio", { name: "浅色" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(radios.getByRole("radio", { name: "跟随系统" }));
    // jsdom has no matchMedia, so "system" is light.
    expect(document.documentElement.dataset.theme).toBe("light");
    await synced(store);
    expect(savedSettings(api)?.theme).toBe("system");
  });

  it("shows the cover picker", async () => {
    await renderApp({ hash: "#/me" });
    expect(screen.getByRole("heading", { name: "本子封面" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "莫奈《鲁昂大教堂》" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getByRole("button", { name: "上传图片" })).toBeTruthy();
  });

  it("sets the case colour, and no longer says the theme colour paints the case", async () => {
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/me" });
    expect(screen.queryByText(/书壳都用/)).toBeNull();
    const section = screen
      .getByRole("heading", { name: "封面颜色" })
      .closest("section") as HTMLElement;
    fireEvent.click(within(section).getByRole("button", { name: "群青" }));
    expect(document.body.style.getPropertyValue("--case-color")).toBe("#4466bb");
    await synced(store);
    expect(savedSettings(api)?.caseColor).toBe("#4466bb");
    expect(savedSettings(api)?.accent).toBeNull();
  });

  it("sets the list text size for this device only", async () => {
    const api = createFakeApi();
    const { store } = await renderApp({ api, hash: "#/me" });
    const sizes = within(screen.getByRole("radiogroup", { name: "清单字号" }));
    expect(sizes.getByRole("radio", { name: "标准" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sizes.getByRole("radio", { name: "特大" }));
    expect(sizes.getByRole("radio", { name: "特大" }).getAttribute("aria-checked")).toBe("true");
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--list-size")).toBe("18px");
    expect(root.getPropertyValue("--list-leading")).toBe("29px");
    expect(window.localStorage.getItem("moli-todo:list-size")).toBe("18");
    await synced(store);
    expect(savedSettings(api)).toBeNull();
    window.localStorage.removeItem("moli-todo:list-size");
    root.removeProperty("--list-size");
    root.removeProperty("--list-leading");
  });
});

describe("MePage conflicts", () => {
  it("lists changes another device beat, and dismisses them", async () => {
    const api = createFakeApi();
    const taskId = seedTask(api, TODAY, "原来的");
    const sessionId = seedSession(api, "阅读", TODAY, 1800);
    const { engine, store } = await renderApp({ api, hash: "#/me" });
    expect(screen.queryByText("没能同步的改动")).toBeNull();

    const task = engine.get("task", taskId)?.data as TaskData;
    const session = engine.get("session", sessionId)?.data as SessionData;
    act(() => {
      // Local changes, and before they are sent, other devices change the same records.
      engine.update("task", taskId, { text: "本地改的" });
      engine.remove("session", sessionId);
      engine.put("settings", "settings", { accent: null, theme: "dark", cover: "monet" });
      api.remote("task", taskId, { ...task, text: "远端改的" });
      api.remote("session", sessionId, { ...session, name: "远端的阅读" });
      api.remote("settings", "settings", { accent: null, theme: "light", cover: "monet" });
    });
    await synced(store);

    const section = (await screen.findByText("没能同步的改动")).closest("section") as HTMLElement;
    expect(within(section).getByText("别的设备先改了同一条，这里的改动没有保存。")).toBeTruthy();
    const items = () =>
      within(section)
        .queryAllByRole("listitem")
        .map((item) => item.firstChild?.textContent);
    expect([...items()].sort()).toEqual(
      ["修改任务「本地改的」", "修改设置", "删除专注记录「阅读」"].sort()
    );
    expect(within(section).getAllByText(/^\d\d:\d\d$/)).toHaveLength(3);
    // The server's versions won.
    expect(engine.get("task", taskId)?.data.text).toBe("远端改的");
    expect(engine.get("session", sessionId)?.data.name).toBe("远端的阅读");

    fireEvent.click(within(section).getAllByRole("button", { name: "知道了" })[0] as HTMLElement);
    expect(items()).toHaveLength(2);
    fireEvent.click(within(section).getAllByRole("button", { name: "知道了" })[0] as HTMLElement);
    fireEvent.click(within(section).getByRole("button", { name: "知道了" }));
    expect(screen.queryByText("没能同步的改动")).toBeNull();
  });
});
