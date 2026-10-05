import { describe, expect, it } from "vitest";
import { hasTag, isValidTagName, parseTags, renameTag, splitTags, tagBeforeCaret } from "./tags";

describe("tags", () => {
  it("finds tags written right after the text, in Chinese or English", () => {
    expect(parseTags("流程图类#小作文")).toEqual(["小作文"]);
    expect(parseTags("R 21-1-2 复盘#阅读 #Reading")).toEqual(["阅读", "Reading"]);
  });

  it("ends a tag at spaces, another # and punctuation", () => {
    expect(parseTags("#a#b,#c。#d d")).toEqual(["a", "b", "c", "d"]);
  });

  it("lists a tag once, ignoring case", () => {
    expect(parseTags("#Read #read #READ")).toEqual(["Read"]);
  });

  it("splits text into plain and tag parts", () => {
    expect(splitTags("思路#大作文 好")).toEqual([
      { text: "思路" },
      { text: "#大作文", tag: "大作文" },
      { text: " 好" },
    ]);
    expect(splitTags("")).toEqual([]);
    expect(splitTags("# 不是标签")).toEqual([{ text: "# 不是标签" }]);
  });

  it("checks for a tag ignoring case", () => {
    expect(hasTag("x #Read", "read")).toBe(true);
    expect(hasTag("x #Reader", "read")).toBe(false);
  });

  it("renames every copy of a tag and leaves longer names alone", () => {
    expect(renameTag("#阅读 R #阅读理解 #阅读", "阅读", "精读")).toBe("#精读 R #阅读理解 #精读");
    expect(renameTag("#Read", "read", "听力")).toBe("#听力");
  });

  it("accepts only names that read back as one tag", () => {
    expect(isValidTagName("阅读")).toBe(true);
    expect(isValidTagName("")).toBe(false);
    expect(isValidTagName("a b")).toBe(false);
    expect(isValidTagName("a#b")).toBe(false);
    expect(isValidTagName("x".repeat(51))).toBe(false);
  });
});

describe("tagBeforeCaret", () => {
  it("finds the tag being typed at the caret", () => {
    expect(tagBeforeCaret("写作#", 3)).toEqual({ start: 2, query: "" });
    expect(tagBeforeCaret("写作 #大作", 6)).toEqual({ start: 3, query: "大作" });
    expect(tagBeforeCaret("#a #b", 5)).toEqual({ start: 3, query: "b" });
  });

  it("is null away from a tag or in the middle of one", () => {
    expect(tagBeforeCaret("写作", 2)).toBeNull();
    expect(tagBeforeCaret("#阅读 好", 5)).toBeNull();
    expect(tagBeforeCaret("#阅读", 2)).toBeNull();
    expect(tagBeforeCaret("#阅读 x", 3)).toEqual({ start: 0, query: "阅读" });
  });
});
