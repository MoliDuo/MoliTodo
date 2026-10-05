import { afterEach, describe, expect, it } from "vitest";
import { applyListSize, DEFAULT_LIST_SIZE, listLeading, parseListSize } from "./list-size";

afterEach(() => {
  document.documentElement.style.removeProperty("--list-size");
  document.documentElement.style.removeProperty("--list-leading");
});

describe("list size", () => {
  it("reads only the sizes on offer", () => {
    expect(parseListSize("17")).toBe(17);
    expect(parseListSize("15")).toBe(15);
    expect(parseListSize(null)).toBe(DEFAULT_LIST_SIZE);
    expect(parseListSize("40")).toBe(DEFAULT_LIST_SIZE);
    expect(parseListSize("big")).toBe(DEFAULT_LIST_SIZE);
  });

  it("gives each size a whole-pixel line height", () => {
    expect(listLeading(15)).toBe(24);
    expect(listLeading(16)).toBe(26);
    expect(listLeading(18)).toBe(29);
  });

  it("sets the CSS variables", () => {
    applyListSize(18);
    expect(document.documentElement.style.getPropertyValue("--list-size")).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--list-leading")).toBe("29px");
  });
});
