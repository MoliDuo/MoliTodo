import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { dayParts, daysInMonth, keyOfDate } from "../lib/time";

const HEAD = ["一", "二", "三", "四", "五", "六", "日"];

/** A month of days to pick from; days with something written get a dot. */
export function Calendar({
  selected,
  today,
  marked,
  onPick,
}: {
  selected: string;
  today: string;
  marked: Set<string>;
  onPick: (day: string) => void;
}) {
  const start = dayParts(selected);
  const [month, setMonth] = useState({ year: start.year, month: start.month });
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
        <span className="font-serif text-base font-semibold">
          {month.year}年{month.month}月
        </span>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => shift(1)}
          className="text-muted hover:text-text rounded-full p-2"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
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
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-label={key}
              aria-pressed={isSelected}
              className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm ${
                isSelected
                  ? "bg-accent text-accent-fg"
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
    </div>
  );
}
