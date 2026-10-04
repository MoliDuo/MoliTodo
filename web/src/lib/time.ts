// Days, dates and durations the way people see them. All days are Singapore days (standard 013): UTC+8, no
// daylight saving, so day arithmetic is plain offset arithmetic and gives the same answer on every device.
// A day is named by its key, "YYYY-MM-DD".

import { MAX_DURATION_MINUTES } from "@shared/records";

const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = 8 * HOUR_MS;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** Midnight (Singapore) at the start of the day that contains `timestamp`. */
export const startOfDay = (timestamp: number): number =>
  Math.floor((timestamp + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;

/** The key of the day that contains `timestamp`. */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp + OFFSET_MS);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Midnight (Singapore) for a day key, or null when it is not a real date. */
export function dayStart(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return utc.getTime() - OFFSET_MS;
}

export interface DayParts {
  year: number;
  month: number;
  day: number;
  /** 0 is Sunday. */
  weekday: number;
}

/** The calendar parts of a day key. The key must be valid. */
export function dayParts(key: string): DayParts {
  const date = new Date((dayStart(key) as number) + OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

export const addDays = (key: string, days: number): string =>
  dayKey((dayStart(key) as number) + days * DAY_MS + HOUR_MS);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number =>
  Math.round(((dayStart(to) as number) - (dayStart(from) as number)) / DAY_MS);

export const keyOfDate = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** "10月4日" */
export function formatMonthDay(key: string): string {
  const p = dayParts(key);
  return `${p.month}月${p.day}日`;
}

/** "周日" */
export const formatWeekday = (key: string): string => WEEKDAYS[dayParts(key).weekday] as string;

/** "今天", "昨天", "明天", or null for other days. */
export function relativeDay(key: string, today: string): string | null {
  const diff = daysBetween(today, key);
  return diff === 0 ? "今天" : diff === -1 ? "昨天" : diff === 1 ? "明天" : null;
}

/** "10月4日 周日", with the year in front when it is not this year. */
export function formatFullDay(key: string, today: string): string {
  const year = dayParts(key).year;
  const prefix = year === dayParts(today).year ? "" : `${year}年`;
  return `${prefix}${formatMonthDay(key)} ${formatWeekday(key)}`;
}

/** Monday of the week that contains the day. */
export function weekStart(key: string): string {
  const weekday = dayParts(key).weekday;
  return addDays(key, weekday === 0 ? -6 : 1 - weekday);
}

/** "00:30" in Singapore time. */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp + OFFSET_MS);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function normalizeDurationText(input: string): string {
  return (
    input
      // Full-width digits, colon and period typed through a Chinese IME.
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/：/g, ":")
      .replace(/[．。]/g, ".")
      .replace(/\s+/g, "")
      .toLowerCase()
  );
}

/**
 * Minutes for "45", "45m", "45min", "45分钟", "1h13min", "1小时30分", "1:30" or "1.5h"; null for an empty input
 * and for one that is not a duration or is longer than 100 hours.
 */
export function parseDuration(input: string): number | null {
  const text = normalizeDurationText(input);
  if (!text) return null;

  let minutes: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d+):([0-5]?\d)$/.exec(text))) {
    minutes = Number(match[1]) * 60 + Number(match[2]);
  } else if (/^\d+$/.test(text)) {
    minutes = Number(text);
  } else if (
    (match =
      /^(?:(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours|小时|时))?(?:(\d+)(?:m|min|mins|分钟|分)?)?$/.exec(
        text
      )) &&
    (match[1] !== undefined || match[2] !== undefined)
  ) {
    minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  }

  if (minutes === null || minutes > MAX_DURATION_MINUTES) return null;
  return Math.round(minutes);
}

/** "1h13min", "45min", "2h": short, for task lines. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${rest}min`;
}

/** "3小时9分", "17分钟", "0分钟": for statistics. Seconds are dropped. */
export function formatLong(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分钟`;
  if (rest === 0) return `${hours}小时`;
  return `${hours}小时${rest}分`;
}

/** "05:09" or "1:05:09": a running stopwatch. */
export function formatStopwatch(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const tail = `${pad2(minutes)}:${pad2(rest)}`;
  return hours > 0 ? `${hours}:${tail}` : tail;
}
