import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "../test-support/render-app";

afterEach(cleanup);

const nav = () => screen.getByRole("navigation", { name: "主导航" });
const current = () =>
  [...nav().querySelectorAll("button")]
    .filter((button) => button.getAttribute("aria-current") === "page")
    .map((button) => button.getAttribute("aria-label"));

describe("Nav", () => {
  it.each([
    ["索引", "#/index"],
    ["本子", "#/book"],
    ["计时", "#/timer"],
    ["我的", "#/me"],
    ["今天", "#/"],
  ])("goes to %s and marks it", async (label, hash) => {
    await renderApp({ hash: label === "今天" ? "#/me" : "#/" });
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(window.location.hash).toBe(hash);
    expect(current()).toEqual([label]);
    const item = screen.getByRole("button", { name: label });
    expect(item.querySelector("span")?.className).toContain("bg-accent-soft");
    expect(item.querySelectorAll("span")[1]?.className).toContain("text-accent-ink");
  });

  it("marks the section a page belongs to", async () => {
    await renderApp({ hash: "#/timer/stats" });
    expect(current()).toEqual(["计时"]);
    cleanup();
    await renderApp({ hash: "#/tag/%E9%98%85%E8%AF%BB" });
    expect(current()).toEqual(["索引"]);
    const other = screen.getByRole("button", { name: "今天" });
    expect(other.getAttribute("aria-current")).toBeNull();
    expect(other.querySelector("span")?.className).toContain("text-muted");
  });
});
