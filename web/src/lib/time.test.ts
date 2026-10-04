import { describe, expect, it } from "vitest";
import {
  addDays,
  formatClock,
  formatDayLabel,
  formatDuration,
  groupCompletedByDay,
  moveToDay,
  parseDateInputValue,
  parseDuration,
  startOfDay,
  toDateInputValue,
} from "./time";

// 2026-10-04 12:00 Singapore
const NOON = Date.parse("2026-10-04T04:00:00Z");
const MIDNIGHT = Date.parse("2026-10-03T16:00:00Z");

describe("days are Singapore days", () => {
  it("finds the start of the day, even when UTC is still on the previous date", () => {
    expect(startOfDay(NOON)).toBe(MIDNIGHT);
    expect(startOfDay(MIDNIGHT)).toBe(MIDNIGHT);
    expect(startOfDay(MIDNIGHT - 1)).toBe(addDays(MIDNIGHT, -1));
    expect(toDateInputValue(Date.parse("2026-10-03T16:30:00Z"))).toBe("2026-10-04");
    expect(formatClock(Date.parse("2026-10-03T16:30:00Z"))).toBe("00:30");
  });

  it("parses date input values and refuses impossible dates", () => {
    expect(parseDateInputValue("2026-10-04")).toBe(MIDNIGHT);
    expect(parseDateInputValue("2026-02-30")).toBeNull();
    expect(parseDateInputValue("2026-13-01")).toBeNull();
    expect(parseDateInputValue("2026/10/04")).toBeNull();
    expect(parseDateInputValue("")).toBeNull();
  });

  it("moves a completion time onto another day, keeping the time of day and never going into the future", () => {
    const doneAt = Date.parse("2026-10-04T01:30:00Z"); // 09:30
    const yesterday = addDays(MIDNIGHT, -1);
    expect(moveToDay(doneAt, yesterday, NOON)).toBe(Date.parse("2026-10-03T01:30:00Z"));
    expect(moveToDay(doneAt, addDays(MIDNIGHT, 3), NOON)).toBe(NOON);
    expect(moveToDay(null, yesterday, NOON)).toBe(yesterday + 12 * 3600_000);
  });

  it("labels days", () => {
    expect(formatDayLabel(MIDNIGHT, NOON)).toBe("今天");
    expect(formatDayLabel(addDays(MIDNIGHT, -1), NOON)).toBe("昨天");
    expect(formatDayLabel(addDays(MIDNIGHT, -2), NOON)).toBe("前天");
    expect(formatDayLabel(addDays(MIDNIGHT, -3), NOON)).toBe("10月1日 星期四");
    expect(formatDayLabel(parseDateInputValue("2025-12-31") as number, NOON)).toBe(
      "2025年12月31日 星期三"
    );
    expect(formatDayLabel(addDays(MIDNIGHT, 1), NOON)).toBe("10月5日 星期一");
  });
});

describe("groupCompletedByDay", () => {
  const task = (id: string, doneAt: number | null, duration = 0, done = true) => ({
    id,
    doneAt,
    duration,
    done,
  });

  it("groups by day, newest first, undated last, with totals", () => {
    const groups = groupCompletedByDay([
      task("old", addDays(MIDNIGHT, -2) + 1000, 30),
      task("a", NOON, 45),
      task("b", NOON + 60_000, 15),
      task("none", null, 5),
      task("open", NOON, 99, false),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      String(MIDNIGHT),
      String(addDays(MIDNIGHT, -2)),
      "undated",
    ]);
    expect(groups[0]?.tasks.map((x) => x.id)).toEqual(["b", "a"]);
    expect(groups.map((g) => g.total)).toEqual([60, 30, 5]);
    expect(groups[2]?.dayStart).toBeNull();
  });

  it("returns nothing when nothing is done", () => {
    expect(groupCompletedByDay([task("x", NOON, 0, false)])).toEqual([]);
  });
});

describe("durations", () => {
  it.each([
    ["", 0],
    ["45", 45],
    ["45m", 45],
    ["45分钟", 45],
    ["45 分", 45],
    ["1h30m", 90],
    ["1小时30分", 90],
    ["1h", 60],
    ["1:30", 90],
    ["1：30", 90],
    ["1.5h", 90],
    ["１．５ｈ".replace("ｈ", "h"), 90],
    ["４５", 45],
    ["100h", 6000],
    ["1h5", 65],
  ])("reads %j as %j minutes", (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it.each(["abc", "101h", "6001", "1:75", "h", "1h30x", "-5"])("refuses %j", (input) => {
    expect(parseDuration(input)).toBeNull();
  });

  it("formats minutes", () => {
    expect([0, 5, 60, 90, 125].map(formatDuration)).toEqual([
      "0分钟",
      "5分钟",
      "1小时",
      "1小时30分",
      "2小时5分",
    ]);
    expect(formatDuration(-3)).toBe("0分钟");
  });
});
