import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { dayParts, daysInMonth, keyOfDate } from "../lib/time";

const HEAD = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * A month of days to pick from; days with something written get a dot. With `enabled`, only those days can be
 * picked; with `years`, a tap on the title lists them to jump between years.
 */
export function Calendar({
  selected,
  today,
  marked,
  enabled,
  years,
  onPick,
}: {
  selected: string;
  today: string;
  marked: Set<string>;
  enabled?: Set<string>;
  years?: number[];
  onPick: (day: string) => void;
}) {
  const start = dayParts(selected);
  const [month, setMonth] = useState({ year: start.year, month: start.month });
  const [choosingYear, setChoosingYear] = useState(false);
  const first = dayParts(keyOfDate(month.year, month.month, 1)).weekday;
  const blanks = (first + 6) % 7;
  const count = daysInMonth(month.year, month.month);
  const shift = (step: number) => {
    const index = month.year * 12 + month.month - 1 + step;
    setMonth({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => shift(-1)}
          className="text-muted hover:text-text rounded-full p-2"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        {years ? (
          <button
            type="button"
            aria-expanded={choosingYear}
            aria-label={`${month.year}年${month.month}月，换一年`}
            onClick={() => setChoosingYear((v) => !v)}
            className="hover:bg-surface-2 flex items-center gap-1 rounded-full px-3 py-1 font-serif text-base font-semibold"
          >
            {month.year}年{month.month}月
            <ChevronDown size={14} className="text-muted" aria-hidden="true" />
          </button>
        ) : (
          <span className="font-serif text-base font-semibold">
            {month.year}年{month.month}月
          </span>
        )}
        <button
          type="button"
          aria-label="下个月"
          onClick={() => shift(1)}
          className="text-muted hover:text-text rounded-full p-2"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      {choosingYear && years ? (
        <div className="grid grid-cols-3 gap-2 py-2" role="group" aria-label="年份">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={y === month.year}
              onClick={() => {
                setChoosingYear(false);
                // Land on the year's last month with something in it.
                const last = [...(enabled ?? [])]
                  .filter((day) => dayParts(day).year === y)
                  .sort()
                  .at(-1);
                setMonth({ year: y, month: last ? dayParts(last).month : month.month });
              }}
              className={`rounded-lg py-2.5 font-serif ${
                y === month.year ? "bg-accent text-accent-fg" : "hover:bg-surface-2"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="text-muted grid grid-cols-7 text-center text-xs">
            {HEAD.map((d) => (
              <span key={d} className="py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {Array.from({ length: blanks }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const key = keyOfDate(month.year, month.month, i + 1);
              const isSelected = key === selected;
              const off = enabled ? !enabled.has(key) : false;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPick(key)}
                  disabled={off}
                  aria-label={key}
                  aria-pressed={isSelected}
                  className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm ${
                    isSelected
                      ? "bg-accent text-accent-fg"
                      : off
                        ? "text-muted/40"
                        : key === today
                          ? "text-accent-ink font-semibold"
                          : "hover:bg-surface-2"
                  }`}
                >
                  {i + 1}
                  {marked.has(key) && !isSelected && (
                    <span className="bg-accent absolute bottom-1 h-1 w-1 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
