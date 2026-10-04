import { describe, expect, it } from "vitest";
import {
  addDays,
  dayKey,
  dayParts,
  daysBetween,
  daysInMonth,
  dayStart,
  formatClock,
  formatDuration,
  formatFullDay,
  formatLong,
  formatMonthDay,
  formatStopwatch,
  formatWeekday,
  keyOfDate,
  parseDuration,
  relativeDay,
  startOfDay,
  weekStart,
} from "./time";

// 2026-10-04 12:00 Singapore
const NOON = Date.parse("2026-10-04T04:00:00Z");
const MIDNIGHT = Date.parse("2026-10-03T16:00:00Z");

describe("days are Singapore days", () => {
  it("finds the day, even when UTC is still on the previous date", () => {
    expect(startOfDay(NOON)).toBe(MIDNIGHT);
    expect(dayKey(MIDNIGHT)).toBe("2026-10-04");
    expect(dayKey(MIDNIGHT - 1)).toBe("2026-10-03");
    expect(dayStart("2026-10-04")).toBe(MIDNIGHT);
    expect(formatClock(Date.parse("2026-10-03T16:30:00Z"))).toBe("00:30");
  });

  it("refuses impossible day keys", () => {
    for (const key of ["2026-02-30", "2026-13-01", "2026/10/04", ""]) {
      expect(dayStart(key)).toBeNull();
    }
  });

  it("does day arithmetic across months and years", () => {
    expect(addDays("2026-10-04", -4)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-04", "2026-09-30")).toBe(-4);
    expect(keyOfDate(2026, 2, 3)).toBe("2026-02-03");
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(dayParts("2026-10-04")).toEqual({ year: 2026, month: 10, day: 4, weekday: 0 });
  });

  it("finds Monday of a week", () => {
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
  });

  it("labels days", () => {
    expect(formatMonthDay("2026-10-04")).toBe("10月4日");
    expect(formatWeekday("2026-10-04")).toBe("周日");
    expect(relativeDay("2026-10-04", "2026-10-04")).toBe("今天");
    expect(relativeDay("2026-10-03", "2026-10-04")).toBe("昨天");
    expect(relativeDay("2026-10-05", "2026-10-04")).toBe("明天");
    expect(relativeDay("2026-10-01", "2026-10-04")).toBeNull();
    expect(formatFullDay("2026-10-01", "2026-10-04")).toBe("10月1日 周四");
    expect(formatFullDay("2025-12-31", "2026-10-04")).toBe("2025年12月31日 周三");
  });
});

describe("durations", () => {
  it("reads the ways people write a duration", () => {
    const cases: [string, number | null][] = [
      ["45", 45],
      ["45m", 45],
      ["45min", 45],
      ["45分钟", 45],
      ["1h13min", 73],
      ["1H13MIN", 73],
      ["1小时30分", 90],
      ["1:30", 90],
      ["１：３０", 90],
      ["1.5h", 90],
      ["2 h", 120],
      ["", null],
      ["  ", null],
      ["abc", null],
      ["1:75", null],
      ["6001", null],
    ];
    for (const [input, minutes] of cases) expect(parseDuration(input), input).toBe(minutes);
  });

  it("writes task durations short", () => {
    expect(formatDuration(73)).toBe("1h13min");
    expect(formatDuration(45)).toBe("45min");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(-3)).toBe("0min");
  });

  it("writes statistics durations in Chinese", () => {
    expect(formatLong(3 * 3600 + 9 * 60 + 30)).toBe("3小时9分");
    expect(formatLong(17 * 60)).toBe("17分钟");
    expect(formatLong(7200)).toBe("2小时");
    expect(formatLong(-1)).toBe("0分钟");
  });

  it("shows a stopwatch", () => {
    expect(formatStopwatch(0)).toBe("00:00");
    expect(formatStopwatch(309.9)).toBe("05:09");
    expect(formatStopwatch(3909)).toBe("1:05:09");
    expect(formatStopwatch(-5)).toBe("00:00");
  });
});
