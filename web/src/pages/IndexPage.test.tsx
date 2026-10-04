import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi } from "../test-support/fake-api";
import { renderApp, seedTask, TODAY } from "../test-support/render-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const searchBox = () => screen.getByRole("searchbox", { name: "搜索" });

describe("IndexPage search", () => {
  it("puts what is typed into the address without a new history entry", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "R 21-1-3 #阅读");
    await renderApp({ api, hash: "#/index" });
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    fireEvent.change(searchBox(), { target: { value: "阅读" } });
    expect(window.location.hash).toBe(`#/index?q=${encodeURIComponent("阅读")}`);
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const results = await screen.findByRole("region", { name: "搜索结果" });
    expect(results.textContent).toContain("R 21-1-3 #阅读");
    expect(screen.queryByRole("region", { name: "标签" })).toBeNull();
  });

  it("groups the results by day, newest first, and opens the day of one", async () => {
    const api = createFakeApi();
    seedTask(api, "2026-10-02", "R 一 #阅读");
    seedTask(api, "2026-10-02", "写信");
    seedTask(api, "2026-10-03", "R 二 #阅读");
    seedTask(api, "2026-10-03", "R 三 #阅读", { done: true, duration: 30 });
    seedTask(api, "2025-12-31", "R 去年 #阅读");
    await renderApp({ api, hash: "#/index?q=%23%E9%98%85%E8%AF%BB%20r" });
    expect(searchBox()).toHaveProperty("value", "#阅读 r");
    const results = screen.getByRole("region", { name: "搜索结果" });
    const days = within(results)
      .getAllByRole("button")
      .filter((button) => !button.textContent?.includes("R "))
      .map((button) => button.textContent);
    expect(days).toEqual(["10月3日 周六", "10月2日 周五", "2025年12月31日 周三"]);
    expect(results.textContent).not.toContain("写信");
    expect(results.textContent).toContain("30min");
    fireEvent.click(within(results).getByRole("button", { name: /^R 一/ }));
    expect(window.location.hash).toBe("#/day/2026-10-02");
  });

  it("opens a day from its heading", async () => {
    const api = createFakeApi();
    seedTask(api, "2026-10-01", "买菜");
    await renderApp({ api, hash: "#/index?q=%E4%B9%B0" });
    fireEvent.click(screen.getByRole("button", { name: "10月1日 周四" }));
    expect(window.location.hash).toBe("#/day/2026-10-01");
  });

  it("opens today without a day in the address", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "买菜");
    await renderApp({ api, hash: "#/index?q=%E4%B9%B0" });
    fireEvent.click(screen.getByRole("button", { name: "买菜" }));
    expect(window.location.hash).toBe("#/");
    cleanup();
    await renderApp({ api, hash: "#/index?q=%E4%B9%B0" });
    fireEvent.click(screen.getByRole("button", { name: "10月4日 周日" }));
    expect(window.location.hash).toBe("#/");
  });

  it("says so when nothing matches", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "买菜");
    await renderApp({ api, hash: "#/index?q=%E8%A5%BF%E7%93%9C" });
    expect(screen.getByText("没有找到")).toBeTruthy();
  });

  it("clears the search and goes back to the tags", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "R #阅读");
    await renderApp({ api, hash: "#/index?q=R" });
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(window.location.hash).toBe("#/index");
    expect(searchBox()).toHaveProperty("value", "");
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
    expect(await screen.findByRole("region", { name: "标签" })).toBeTruthy();
  });

  it("shows the tags while the search is only spaces", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "R #阅读");
    await renderApp({ api, hash: "#/index" });
    fireEvent.change(searchBox(), { target: { value: "   " } });
    expect(screen.getByRole("region", { name: "标签" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "清除" })).toBeTruthy();
  });
});

describe("IndexPage tags", () => {
  it("says how to make a tag when there is none", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "买菜");
    await renderApp({ api, hash: "#/index" });
    expect(screen.getByRole("region", { name: "标签" }).textContent).toContain("还没有标签");
    expect(screen.queryAllByRole("listitem")).toHaveLength(5); // only the nav
  });

  it("lists the tags most used first, with counts and time", async () => {
    const api = createFakeApi();
    seedTask(api, "2026-10-03", "R 21-1-3#阅读", { done: true, duration: 50 });
    seedTask(api, "2026-10-03", "复盘", { indent: 1, done: true, duration: 20 });
    seedTask(api, "2026-10-03", "跑步 #运动");
    seedTask(api, TODAY, "R 21-1-4 #阅读", { duration: 15 });
    seedTask(api, TODAY, "", { indent: 1 });
    api.remote("tag", "阅读", { name: "阅读", color: "#3f7d5c" });
    await renderApp({ api, hash: "#/index" });
    const region = screen.getByRole("region", { name: "标签" });
    expect(region.textContent).not.toContain("还没有标签");
    const rows = within(region).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["阅读1h25min3 条记录", "运动1 条记录"]);
    const icons = rows.map((row) => row.querySelector("svg") as SVGElement);
    expect(icons[0]?.style.color).toBe("rgb(63, 125, 92)");
    expect(icons[1]?.style.color).toBe("var(--accent-ink, var(--moli-accent))");
    fireEvent.click(rows[1] as HTMLElement);
    expect(window.location.hash).toBe(`#/tag/${encodeURIComponent("运动")}`);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("#运动")
    );
  });
});
