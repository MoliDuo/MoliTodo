import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate, parseRoute, routeHash, type Route } from "./router";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "#/");
});

describe("parseRoute and routeHash", () => {
  const routes: [string, Route][] = [
    ["#/", { name: "today", day: null }],
    ["#/day/2026-10-04", { name: "today", day: "2026-10-04" }],
    ["#/index", { name: "index", query: "" }],
    ["#/index?q=%E9%98%85%E8%AF%BB%20R", { name: "index", query: "阅读 R" }],
    ["#/tag/%E9%98%85%E8%AF%BB", { name: "tag", tag: "阅读" }],
    ["#/tag/a%2Fb", { name: "tag", tag: "a/b" }],
    ["#/book", { name: "book", year: null, day: null }],
    ["#/book/2025", { name: "book", year: 2025, day: null }],
    ["#/book/2025?day=2025-03-01", { name: "book", year: 2025, day: "2025-03-01" }],
    ["#/book?day=2025-03-01", { name: "book", year: null, day: "2025-03-01" }],
    ["#/timer", { name: "timer" }],
    ["#/timer/stats", { name: "stats" }],
    ["#/me", { name: "me" }],
  ];

  it.each(routes)("reads %s and writes it back the same", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    expect(routeHash(route)).toBe(hash);
  });

  it("goes to today for an empty or unknown hash", () => {
    expect(parseRoute("")).toEqual({ name: "today", day: null });
    expect(parseRoute("#")).toEqual({ name: "today", day: null });
    expect(parseRoute("#/nowhere/at/all")).toEqual({ name: "today", day: null });
  });

  it("drops a day that is not written as YYYY-MM-DD", () => {
    expect(parseRoute("#/day/2026-1-4")).toEqual({ name: "today", day: null });
    expect(parseRoute("#/day/tomorrow")).toEqual({ name: "today", day: null });
    expect(parseRoute("#/day")).toEqual({ name: "today", day: null });
    expect(parseRoute("#/book/2025?day=soon")).toEqual({ name: "book", year: 2025, day: null });
  });

  it("drops a year that is not a whole number after 1900", () => {
    expect(parseRoute("#/book/1900")).toEqual({ name: "book", year: null, day: null });
    expect(parseRoute("#/book/2025.5")).toEqual({ name: "book", year: null, day: null });
    expect(parseRoute("#/book/abc")).toEqual({ name: "book", year: null, day: null });
  });

  it("goes to the index when the tag is missing", () => {
    expect(parseRoute("#/tag")).toEqual({ name: "index", query: "" });
    expect(parseRoute("#/tag/")).toEqual({ name: "index", query: "" });
  });

  it("keeps a part as written when its percent-encoding is broken", () => {
    expect(parseRoute("#/tag/%E9%98")).toEqual({ name: "tag", tag: "%E9%98" });
    expect(parseRoute("#/tag/100%")).toEqual({ name: "tag", tag: "100%" });
  });

  it("reads a hash without the leading slash", () => {
    expect(parseRoute("#me")).toEqual({ name: "me" });
    expect(parseRoute("timer/stats")).toEqual({ name: "stats" });
  });
});

describe("navigate", () => {
  it("pushes a new history entry and tells listeners", () => {
    window.history.replaceState(null, "", "#/");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const listener = vi.fn();
    window.addEventListener("hashchange", listener);
    navigate({ name: "me" });
    window.removeEventListener("hashchange", listener);
    expect(push).toHaveBeenCalledWith(null, "", "#/me");
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/me");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("replaces the entry when asked", () => {
    window.history.replaceState(null, "", "#/index");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    navigate({ name: "index", query: "R" }, true);
    expect(replace).toHaveBeenCalledWith(null, "", "#/index?q=R");
    expect(push).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/index?q=R");
  });

  it("does nothing when already there", () => {
    window.history.replaceState(null, "", "#/timer");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const listener = vi.fn();
    window.addEventListener("hashchange", listener);
    navigate({ name: "timer" });
    navigate({ name: "timer" }, true);
    window.removeEventListener("hashchange", listener);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});
