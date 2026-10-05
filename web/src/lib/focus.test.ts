import { describe, expect, it } from "vitest";
import {
  deleteSession,
  distribution,
  elapsed,
  finishTimer,
  getTimer,
  isRunning,
  monthSeries,
  pauseTimer,
  rangeOf,
  saveSession,
  sessions,
  setTimerName,
  shiftAnchor,
  startTimer,
  totals,
  UNNAMED,
  yearSeries,
} from "./focus";
import { SyncEngine } from "./sync";
import type { SessionData } from "@shared/records";

const engine = () =>
  new SyncEngine({
    transport: {
      put: async () => ({ kind: "conflict", record: null }),
      changes: async (cursor) => ({ records: [], cursor, hasMore: false }),
    },
  });

// 2026-10-04 10:00 Singapore
const T = Date.parse("2026-10-04T02:00:00Z");
const MIN = 60_000;

describe("stopwatch", () => {
  it("counts while running, holds while paused, and resumes", () => {
    const e = engine();
    setTimerName(e, "  大作文  ");
    startTimer(e, T);
    startTimer(e, T + MIN);
    expect(isRunning(getTimer(e))).toBe(true);
    expect(elapsed(getTimer(e), T + 2 * MIN)).toBe(120);
    pauseTimer(e, T + 2 * MIN);
    pauseTimer(e, T + 3 * MIN);
    expect(elapsed(getTimer(e), T + 10 * MIN)).toBe(120);
    startTimer(e, T + 10 * MIN);
    expect(elapsed(getTimer(e), T + 11 * MIN)).toBe(180);
    expect(getTimer(e)).toMatchObject({ name: "大作文", startedAt: T });
  });

  it("keeps a long enough run as a session and resets, keeping the name", () => {
    const e = engine();
    setTimerName(e, "大作文");
    startTimer(e, T);
    expect(finishTimer(e, T + 25 * MIN)).toBe(1500);
    expect(getTimer(e)).toEqual({
      name: "大作文",
      startedAt: null,
      accumulated: 0,
      runningSince: null,
    });
    expect(sessions(e).map((s) => s.data)).toEqual([
      { name: "大作文", startedAt: T, endedAt: T + 25 * MIN, seconds: 1500, day: "2026-10-04" },
    ]);
  });

  it("drops a short run, names unnamed runs, and ignores finishing when not started", () => {
    const e = engine();
    expect(finishTimer(e, T)).toBe(0);
    startTimer(e, T);
    expect(finishTimer(e, T + 30_000)).toBe(0);
    expect(sessions(e)).toEqual([]);
    startTimer(e, T);
    finishTimer(e, T + 2 * MIN);
    expect(sessions(e)[0]?.data.name).toBe(UNNAMED);
  });

  it("lists sessions newest first and deletes them", () => {
    const e = engine();
    for (const [name, at] of [
      ["a", 0],
      ["b", 10],
      ["a", 20],
    ] as const) {
      setTimerName(e, name);
      startTimer(e, T + at * MIN);
      finishTimer(e, T + (at + 5) * MIN);
    }
    expect(sessions(e).map((s) => s.data.name)).toEqual(["a", "b", "a"]);
    deleteSession(e, sessions(e)[0]!.id);
    expect(sessions(e)).toHaveLength(2);
  });
});

describe("sessions written in by hand", () => {
  it("adds one at a day and time, and changes it", () => {
    const e = engine();
    const id = saveSession(e, null, {
      name: " 阅读 ",
      day: "2026-10-04",
      start: "9:05",
      minutes: 50,
    });
    expect(id).not.toBeNull();
    // 09:05 in Singapore is 01:05 UTC.
    const startedAt = Date.UTC(2026, 9, 4, 1, 5);
    expect(e.get("session", id as string)?.data).toEqual({
      name: "阅读",
      day: "2026-10-04",
      startedAt,
      endedAt: startedAt + 50 * 60_000,
      seconds: 3000,
    });
    saveSession(e, id, { name: "", day: "2026-10-03", start: "23:30", minutes: 90 });
    expect(sessions(e)).toHaveLength(1);
    expect(e.get("session", id as string)?.data).toMatchObject({
      name: UNNAMED,
      day: "2026-10-03",
      seconds: 5400,
    });
  });

  it("refuses a day, time or length that does not make sense", () => {
    const e = engine();
    const ok = { name: "a", day: "2026-10-04", start: "10:00", minutes: 30 };
    expect(saveSession(e, null, { ...ok, day: "2026-02-30" })).toBeNull();
    expect(saveSession(e, null, { ...ok, start: "24:00" })).toBeNull();
    expect(saveSession(e, null, { ...ok, minutes: 0 })).toBeNull();
    expect(saveSession(e, null, { ...ok, minutes: 24 * 60 + 1 })).toBeNull();
    expect(saveSession(e, null, { ...ok, minutes: 24 * 60 })).not.toBeNull();
  });
});

describe("statistics", () => {
  const s = (name: string, day: string, seconds: number): SessionData => ({
    name,
    day,
    seconds,
    startedAt: 0,
    endedAt: 0,
  });
  const list = [
    s("物化讲解", "2026-10-01", 3600),
    s("单词", "2026-10-04", 1800),
    s("物化讲解", "2026-10-04", 1800),
    s("单词", "2026-09-30", 600),
  ];

  it("adds up the total and the average per day since the first", () => {
    expect(totals(list, "2026-10-04")).toEqual({ seconds: 7800, perDay: 1560 });
    expect(totals([], "2026-10-04")).toEqual({ seconds: 0, perDay: 0 });
  });

  it("splits a range by name with shares", () => {
    const slices = distribution(list, "2026-10-01", "2026-10-04");
    expect(slices).toEqual([
      { name: "物化讲解", seconds: 5400, share: 0.75 },
      { name: "单词", seconds: 1800, share: 0.25 },
    ]);
    expect(distribution(list, "2027-01-01", "2027-01-02")).toEqual([]);
    expect(
      distribution([s("b", "2026-10-01", 0), s("a", "2026-10-01", 0)], "2026-10-01", "2026-10-01")
    ).toEqual([
      { name: "a", seconds: 0, share: 0 },
      { name: "b", seconds: 0, share: 0 },
    ]);
  });

  it("makes month and year series", () => {
    const october = monthSeries(list, 2026, 10);
    expect(october).toHaveLength(31);
    expect(october[0]).toEqual({ label: "10-1", seconds: 3600 });
    expect(october[3]?.seconds).toBe(3600);
    const year = yearSeries(list, 2026);
    expect(year[8]).toEqual({ label: "9月", seconds: 600 });
    expect(year[9]?.seconds).toBe(7200);
    expect(yearSeries(list, 2025).every((p) => p.seconds === 0)).toBe(true);
  });

  it("finds and moves day, week and month ranges", () => {
    expect(rangeOf("day", "2026-10-04")).toEqual(["2026-10-04", "2026-10-04"]);
    expect(rangeOf("week", "2026-10-04")).toEqual(["2026-09-28", "2026-10-04"]);
    expect(rangeOf("week", "2026-10-05")).toEqual(["2026-10-05", "2026-10-11"]);
    expect(rangeOf("month", "2026-02-14")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(shiftAnchor("day", "2026-10-04", -1)).toBe("2026-10-03");
    expect(shiftAnchor("week", "2026-10-04", 1)).toBe("2026-10-11");
    expect(shiftAnchor("month", "2026-12-14", 1)).toBe("2027-01-01");
    expect(shiftAnchor("month", "2026-01-14", -1)).toBe("2025-12-01");
  });
});
