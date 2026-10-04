import { describe, expect, it } from "vitest";
import {
  addTask,
  deleteTask,
  getSettings,
  groupByDay,
  leftFromYesterday,
  moveTask,
  moveTasksToDay,
  renameTagEverywhere,
  saveSettings,
  saveUploadedCover,
  searchTasks,
  setHighlight,
  setTagColor,
  tagColor,
  tagSummaries,
  tasksOfDay,
  tasksWithTag,
  toggleTask,
  totalMinutes,
  updateTask,
  uploadedCover,
  writtenTasks,
} from "./model";
import { SyncEngine } from "./sync";

const engine = () =>
  new SyncEngine({
    transport: {
      put: async () => ({ kind: "conflict", record: null }),
      changes: async (cursor) => ({ records: [], cursor, hasMore: false }),
    },
  });

const DAY = "2026-10-04";
const texts = (e: SyncEngine, day = DAY) => tasksOfDay(e, day).map((t) => t.data.text);

describe("day lists", () => {
  it("adds at the end or right after a task, and keeps days apart", () => {
    const e = engine();
    const a = addTask(e, DAY, { text: "a" });
    addTask(e, DAY, { text: "c" });
    addTask(e, DAY, { text: "b", after: a, indent: 9 });
    addTask(e, "2026-10-03", { text: "yesterday" });
    addTask(e, DAY, { text: "first", after: null });
    expect(texts(e)).toEqual(["first", "a", "b", "c"]);
    expect(tasksOfDay(e, DAY)[2]?.data.indent).toBe(3);
    expect(texts(e, "2026-10-03")).toEqual(["yesterday"]);
  });

  it("updates, clamps indent, and skips changes that change nothing", () => {
    const e = engine();
    const id = addTask(e, DAY, { text: "a" });
    updateTask(e, id, { indent: -2 });
    expect(e.get("task", id)?.data.indent).toBe(0);
    const before = e.getState().pending;
    updateTask(e, id, { text: "a" });
    expect(e.getState().pending).toBe(before);
    updateTask(e, "missing", { text: "x" });
    expect(e.get("task", "missing")).toBeNull();
  });

  it("ticks with the time and unticks", () => {
    const e = engine();
    const id = addTask(e, DAY, { text: "a" });
    expect(toggleTask(e, id, 5)).toBe(true);
    expect(e.get("task", id)?.data).toMatchObject({ done: true, doneAt: 5 });
    expect(toggleTask(e, id, 6)).toBe(false);
    expect(e.get("task", id)?.data).toMatchObject({ done: false, doneAt: null });
    expect(toggleTask(e, "missing", 1)).toBe(false);
  });

  it("highlights, deletes and adds up minutes", () => {
    const e = engine();
    const a = addTask(e, DAY, { text: "a" });
    const b = addTask(e, DAY, { text: "b" });
    setHighlight(e, a, "yellow");
    updateTask(e, a, { duration: 73 });
    updateTask(e, b, { duration: 10 });
    expect(e.get("task", a)?.data.highlight).toBe("yellow");
    expect(totalMinutes(tasksOfDay(e, DAY))).toBe(83);
    deleteTask(e, b);
    expect(texts(e)).toEqual(["a"]);
  });

  it("moves a task within its day", () => {
    const e = engine();
    const a = addTask(e, DAY, { text: "a" });
    const b = addTask(e, DAY, { text: "b" });
    const c = addTask(e, DAY, { text: "c" });
    moveTask(e, c, a);
    expect(texts(e)).toEqual(["c", "a", "b"]);
    moveTask(e, c, null);
    expect(texts(e)).toEqual(["a", "b", "c"]);
    moveTask(e, a, "missing");
    moveTask(e, "missing", b);
    expect(texts(e)).toEqual(["a", "b", "c"]);
  });

  it("offers yesterday's open written tasks and moves them to the end of today", () => {
    const e = engine();
    addTask(e, DAY, { text: "today" });
    const open = addTask(e, "2026-10-03", { text: "open" });
    const done = addTask(e, "2026-10-03", { text: "done" });
    addTask(e, "2026-10-03", { text: "  " });
    addTask(e, "2026-10-02", { text: "older" });
    toggleTask(e, done, 1);
    const left = leftFromYesterday(e, DAY);
    expect(left.map((t) => t.data.text)).toEqual(["open"]);
    moveTasksToDay(e, [open, "missing"], DAY);
    moveTasksToDay(e, [open], DAY);
    expect(texts(e)).toEqual(["today", "open"]);
    expect(leftFromYesterday(e, DAY)).toEqual([]);
  });
});

describe("tags and search", () => {
  function sample() {
    const e = engine();
    const a = addTask(e, "2026-10-03", { text: "R 21-1-3#阅读" });
    addTask(e, DAY, { text: "R 21-1-2 复盘#阅读" });
    addTask(e, DAY, { text: "思路#大作文" });
    addTask(e, DAY, { text: "" });
    toggleTask(e, a, 1);
    updateTask(e, a, { duration: 30 });
    return e;
  }

  it("counts tags with done and minutes, most used first", () => {
    const e = sample();
    setTagColor(e, "阅读", "#123456");
    expect(tagSummaries(e)).toEqual([
      { key: "阅读", name: "阅读", color: "#123456", count: 2, done: 1, minutes: 30 },
      { key: "大作文", name: "大作文", color: null, count: 1, done: 0, minutes: 0 },
    ]);
    expect(tasksWithTag(e, "阅读")).toHaveLength(2);
  });

  it("counts a line indented under a tagged line under that tag too", () => {
    const e = engine();
    addTask(e, DAY, { text: "R 21-1-3#阅读" });
    addTask(e, DAY, { text: "复盘", indent: 1 });
    addTask(e, DAY, { text: "笔记#口语", indent: 2 });
    addTask(e, DAY, { text: "单词", indent: 1 });
    addTask(e, DAY, { text: "别的" });
    addTask(e, "2026-10-05", { text: "下一天", indent: 1 });
    expect(tasksWithTag(e, "阅读").map((t) => t.data.text)).toEqual([
      "R 21-1-3#阅读",
      "复盘",
      "笔记#口语",
      "单词",
    ]);
    expect(tasksWithTag(e, "口语").map((t) => t.data.text)).toEqual(["笔记#口语"]);
    expect(tagSummaries(e).map((t) => [t.name, t.count])).toEqual([
      ["阅读", 4],
      ["口语", 1],
    ]);
  });

  it("renames a tag in every task and keeps its colour", () => {
    const e = sample();
    setTagColor(e, "阅读", "#123456");
    renameTagEverywhere(e, "阅读", "精读");
    expect(tasksWithTag(e, "阅读")).toHaveLength(0);
    expect(tasksWithTag(e, "精读")).toHaveLength(2);
    expect(tagColor(e, "精读")).toBe("#123456");
    expect(tagColor(e, "阅读")).toBeNull();
    renameTagEverywhere(e, "大作文", "大作文");
    expect(tasksWithTag(e, "大作文")).toHaveLength(1);
  });

  it("searches written tasks for every word, newest day first", () => {
    const e = sample();
    expect(searchTasks(e, "r 阅读").map((t) => t.data.day)).toEqual(["2026-10-04", "2026-10-03"]);
    expect(searchTasks(e, "  ")).toEqual([]);
    expect(searchTasks(e, "复盘 大作文")).toEqual([]);
  });

  it("groups tasks by day in the order given", () => {
    const e = sample();
    const groups = groupByDay(writtenTasks(e));
    expect(groups.map((g) => [g.day, g.tasks.length])).toEqual([
      ["2026-10-03", 1],
      ["2026-10-04", 2],
    ]);
  });
});

describe("appearance", () => {
  it("has defaults and keeps changes", () => {
    const e = engine();
    expect(getSettings(e)).toEqual({ accent: null, theme: "system", cover: "monet" });
    saveSettings(e, { accent: "#123456" });
    expect(getSettings(e).accent).toBe("#123456");
    expect(uploadedCover(e)).toBeNull();
    saveUploadedCover(e, "data:image/jpeg;base64,AA==");
    expect(uploadedCover(e)).toBe("data:image/jpeg;base64,AA==");
    expect(getSettings(e)).toMatchObject({ accent: "#123456", cover: "upload" });
  });
});
