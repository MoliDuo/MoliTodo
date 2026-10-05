import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { SessionData } from "@shared/records";
import { Sheet } from "../components/Sheet";
import { useApp } from "../context";
import { minuteTicks, polar, slicePath, smoothPath, SLICE_COLORS } from "../lib/chart";
import {
  deleteSession,
  MAX_SESSION_MINUTES,
  saveSession,
  distribution,
  monthSeries,
  rangeOf,
  sessions,
  shiftAnchor,
  totals,
  yearSeries,
  type Point,
  type RangeKind,
  type Slice,
} from "../lib/focus";
import {
  dayKey,
  dayParts,
  formatClock,
  formatDuration,
  formatFullDay,
  formatLong,
  formatMonthDay,
  parseDuration,
} from "../lib/time";
import { navigate } from "../router";

const RANGES: { kind: RangeKind; label: string }[] = [
  { kind: "day", label: "日" },
  { kind: "week", label: "周" },
  { kind: "month", label: "月" },
  { kind: "custom", label: "自定义" },
];

function Card({
  title,
  extra,
  children,
}: {
  title: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-surface-2/70 rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Stepper({ onStep, label }: { onStep: (step: number) => void; label: string }) {
  return (
    <div className="text-muted flex items-center">
      <button
        type="button"
        aria-label={`上一${label}`}
        onClick={() => onStep(-1)}
        className="hover:text-text rounded-full p-1.5"
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`下一${label}`}
        onClick={() => onStep(1)}
        className="hover:text-text rounded-full p-1.5"
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/** "3小时9分" with the numbers big and the units small. */
function BigTime({ seconds }: { seconds: number }) {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <span className="font-serif">
      {h > 0 && (
        <>
          <span className="text-[28px] font-semibold">{h}</span>
          <span className="text-muted mr-1 ml-0.5 text-xs">小时</span>
        </>
      )}
      <span className="text-[28px] font-semibold">{m}</span>
      <span className="text-muted ml-0.5 text-xs">分钟</span>
    </span>
  );
}

const sliceColor = (i: number) =>
  i === 0 ? "var(--moli-accent)" : SLICE_COLORS[(i - 1) % SLICE_COLORS.length];

function Pie({ slices }: { slices: Slice[] }) {
  const size = 300;
  const r = 92;
  const c = size / 2;
  const parts = slices.map((slice, i) => {
    const from = slices.slice(0, i).reduce((sum, s) => sum + s.share, 0);
    return { slice, from, to: from + slice.share, color: sliceColor(i) };
  });
  if (slices.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${size} ${size - 60}`}
        className="mx-auto block w-full max-w-[300px]"
        aria-hidden="true"
      >
        <circle cx={c} cy={c - 30} r={r} fill="var(--moli-border)" opacity="0.5" />
        <text x={c} y={c - 26} textAnchor="middle" className="fill-[var(--moli-muted)] text-[13px]">
          这段时间没有专注记录
        </text>
      </svg>
    );
  }
  return (
    // Wider than the circle so the outer labels on both sides fit.
    <svg
      viewBox={`-50 0 ${size + 100} ${size - 40}`}
      className="mx-auto block w-full max-w-[400px]"
      role="img"
      aria-label="专注时长分布"
    >
      <g transform="translate(0,-20)">
        {parts.map(({ slice, from, to, color }) => (
          <path
            key={slice.name}
            d={slicePath(c, c, r, from, to)}
            fill={color}
            stroke="var(--moli-surface)"
            strokeWidth="1.5"
          />
        ))}
        {parts.length === 1 && (
          <text x={c} y={c + 5} textAnchor="middle" fill="#fff" className="text-[13px] font-medium">
            {parts[0]?.slice.name}
          </text>
        )}
        {parts.map(({ slice, from, to }) => {
          if (slice.share < 0.05 || parts.length === 1) return null;
          const mid = (from + to) / 2;
          const inner = polar(c, c, r * 0.62, mid);
          const edge = polar(c, c, r + 3, mid);
          const out = polar(c, c, r + 16, mid);
          const right = out.x >= c;
          const end = { x: out.x + (right ? 12 : -12), y: out.y };
          return (
            <g key={slice.name} className="text-[10.5px]">
              <text
                x={inner.x}
                y={inner.y + 4}
                textAnchor="middle"
                fill="#fff"
                className="font-medium"
                style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.25)", strokeWidth: 2 }}
              >
                {slice.name.length > 6 ? `${slice.name.slice(0, 6)}…` : slice.name}
              </text>
              <polyline
                points={`${edge.x},${edge.y} ${out.x},${out.y} ${end.x},${end.y}`}
                fill="none"
                stroke="var(--moli-muted)"
                strokeWidth="0.8"
              />
              <text
                x={end.x + (right ? 3 : -3)}
                y={end.y + 3.5}
                textAnchor={right ? "start" : "end"}
                fill="var(--moli-muted)"
              >
                {formatLong(slice.seconds)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** A smooth area chart in minutes, with the value written over each point that has one. */
function AreaChart({ points, labelEvery }: { points: Point[]; labelEvery: number }) {
  const id = useId().replace(/:/g, "");
  const width = 340;
  const height = 190;
  const left = 38;
  const right = 18;
  const top = 22;
  const bottom = 24;
  const minutes = points.map((p) => p.seconds / 60);
  const ticks = minuteTicks(Math.max(0, ...minutes));
  const max = ticks[ticks.length - 1] as number;
  const x = (i: number) => left + (i * (width - left - right)) / Math.max(1, points.length - 1);
  const y = (m: number) => top + (1 - m / max) * (height - top - bottom);
  const xy = minutes.map((m, i) => ({ x: x(i), y: y(m) }));
  const line = smoothPath(xy);
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const tickLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}分`);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      role="img"
      aria-label="专注时长曲线"
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--moli-accent)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--moli-accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((m) => (
        <g key={m}>
          <line
            x1={left}
            x2={width - right}
            y1={y(m)}
            y2={y(m)}
            stroke="var(--moli-border)"
            strokeWidth="0.6"
          />
          <text x={left - 5} y={y(m) + 3} textAnchor="end" fontSize="9" fill="var(--moli-muted)">
            {tickLabel(m)}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#${id}-fill)`} />
      <path d={line} fill="none" stroke="var(--accent-ink, var(--moli-accent))" strokeWidth="1.8" />
      {points.map((p, i) => (
        <g key={p.label}>
          {i % labelEvery === 0 && (
            <text x={x(i)} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--moli-muted)">
              {p.label}
            </text>
          )}
          {p.seconds >= 60 && (
            <>
              <circle
                cx={x(i)}
                cy={y(p.seconds / 60)}
                r="2.4"
                fill="var(--accent-ink, var(--moli-accent))"
              />
              {points.length <= 12 || p.seconds / 60 >= max * 0.15 ? (
                <text
                  x={x(i)}
                  y={y(p.seconds / 60) - 6}
                  textAnchor="middle"
                  fontSize="8.5"
                  fill="var(--moli-text)"
                >
                  {formatLong(p.seconds)}
                </text>
              ) : null}
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

const field =
  "bg-surface-2 focus:ring-accent w-full min-w-0 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1";

/** Writes in a session by hand, or changes one: name, day, when it began and how long it took. */
function SessionForm({
  session,
  onDone,
}: {
  session: { id: string; data: SessionData } | null;
  onDone: () => void;
}) {
  const { engine, now } = useApp();
  const [name, setName] = useState(session?.data.name ?? "");
  const [day, setDay] = useState(session?.data.day ?? dayKey(now));
  const [start, setStart] = useState(formatClock(session?.data.startedAt ?? now));
  const [length, setLength] = useState(
    session ? formatDuration(Math.round(session.data.seconds / 60)) : ""
  );
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const minutes = parseDuration(length);
    if (minutes === null || minutes < 1 || minutes > MAX_SESSION_MINUTES)
      return setProblem("用时写成 25min、1h20min 这样，1 分钟到 24 小时");
    if (!saveSession(engine, session?.id ?? null, { name, day, start, minutes }))
      return setProblem("日期或开始时间不对");
    onDone();
  };

  return (
    <Sheet title={session ? "修改记录" : "添加记录"} onClose={onDone}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="block">
          <span className="text-muted mb-1 block text-xs">名称</span>
          <input
            value={name}
            autoFocus={!session}
            onChange={(event) => setName(event.target.value)}
            placeholder="比如 单词"
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-muted mb-1 block text-xs">日期</span>
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="text-muted mb-1 block text-xs">开始时间</span>
            <input
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className={field}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-muted mb-1 block text-xs">用时</span>
          <input
            value={length}
            inputMode="text"
            onChange={(event) => {
              setLength(event.target.value);
              setProblem(null);
            }}
            placeholder="25min、1h20min"
            className={field}
          />
        </label>
        {problem && <p className="text-danger text-xs">{problem}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onDone}
            className="text-muted rounded-lg px-4 py-2 text-sm"
          >
            取消
          </button>
          <button type="submit" className="bg-accent text-accent-fg rounded-lg px-5 py-2 text-sm">
            保存
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function SessionList({
  list,
  onClose,
}: {
  list: { id: string; data: SessionData }[];
  onClose: () => void;
}) {
  const { engine, today } = useApp();
  // The form takes the list's place while it is open, so Esc closes one at a time.
  const [editing, setEditing] = useState<{ id: string; data: SessionData } | "new" | null>(null);
  if (editing)
    return (
      <SessionForm session={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
    );
  return (
    <Sheet
      title="专注记录"
      onClose={onClose}
      actions={
        <button
          type="button"
          aria-label="添加记录"
          onClick={() => setEditing("new")}
          className="text-accent-ink hover:bg-accent-soft rounded-full p-2"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      }
    >
      {list.length === 0 && <p className="text-muted py-6 text-center text-sm">这段时间没有记录</p>}
      <ul className="divide-border divide-y">
        {list.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px]">{s.data.name}</p>
              <p className="text-muted text-xs">
                {formatFullDay(s.data.day, today)} {formatClock(s.data.startedAt)}–
                {formatClock(s.data.endedAt)}
              </p>
            </div>
            <span className="mr-1 font-serif text-sm">{formatLong(s.data.seconds)}</span>
            <button
              type="button"
              aria-label={`修改 ${s.data.name}`}
              onClick={() => setEditing(s)}
              className="text-muted hover:text-text rounded-full p-1.5"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`删除 ${s.data.name}`}
              onClick={() => {
                if (window.confirm(`删除这条「${s.data.name}」的记录？`))
                  deleteSession(engine, s.id);
              }}
              className="text-muted hover:text-danger rounded-full p-1.5"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function StatsPage() {
  const { engine, today, tick } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => sessions(engine), [engine, tick]);
  const list = all.map((s) => s.data);
  const sum = totals(list, today);

  const [kind, setKind] = useState<RangeKind>("week");
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState<[string, string]>(() => rangeOf("week", today));
  const [from, to] = kind === "custom" ? custom : rangeOf(kind, anchor);
  const slices = distribution(list, from, to);
  const rangeSeconds = slices.reduce((s, x) => s + x.seconds, 0);
  const [records, setRecords] = useState(false);

  const t = dayParts(today);
  const [month, setMonth] = useState({ year: t.year, month: t.month });
  const [year, setYear] = useState(t.year);

  const rangeLabel =
    kind === "day"
      ? formatFullDay(from, today)
      : kind === "month"
        ? `${dayParts(from).year}年${dayParts(from).month}月`
        : `${formatMonthDay(from)} – ${formatMonthDay(to)}`;

  return (
    <div className="mx-auto max-w-xl px-5 pb-6">
      <header className="flex items-center gap-3 pt-4 pb-3">
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate({ name: "timer" })}
          className="hover:bg-surface-2 -ml-2 rounded-full p-2"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="text-xl font-medium">统计</h1>
      </header>

      <div className="space-y-3">
        <Card title="累计专注">
          <div className="grid grid-cols-2">
            <div>
              <p className="text-muted mb-0.5 text-xs">时长</p>
              <BigTime seconds={sum.seconds} />
            </div>
            <div>
              <p className="text-muted mb-0.5 text-xs">日均时长</p>
              <BigTime seconds={sum.perDay} />
            </div>
          </div>
        </Card>

        <Card
          title={
            <span>
              专注时长分布 <span className="text-muted ml-1 font-normal">{rangeLabel}</span>
            </span>
          }
          extra={
            kind !== "custom" && (
              <Stepper
                label={RANGES.find((r) => r.kind === kind)?.label ?? ""}
                onStep={(step) =>
                  setAnchor((a) => shiftAnchor(kind as Exclude<RangeKind, "custom">, a, step))
                }
              />
            )
          }
        >
          <div className="bg-surface mb-3 grid grid-cols-4 rounded-lg p-0.5 text-sm" role="tablist">
            {RANGES.map((r) => (
              <button
                key={r.kind}
                type="button"
                role="tab"
                aria-selected={kind === r.kind}
                onClick={() => {
                  setKind(r.kind);
                  setAnchor(today);
                }}
                className={`rounded-md py-1.5 ${kind === r.kind ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {kind === "custom" && (
            <div className="mb-3 flex items-center justify-center gap-2 text-sm">
              <input
                type="date"
                aria-label="开始日期"
                value={custom[0]}
                max={custom[1]}
                onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])}
                className="bg-surface rounded-md px-2 py-1"
              />
              <span className="text-muted">至</span>
              <input
                type="date"
                aria-label="结束日期"
                value={custom[1]}
                min={custom[0]}
                onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])}
                className="bg-surface rounded-md px-2 py-1"
              />
            </div>
          )}
          <Pie slices={slices} />
          <p className="mt-1 text-center text-sm">
            总计 <b className="font-serif">{formatLong(rangeSeconds)}</b>
          </p>
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setRecords(true)}
              className="bg-surface hover:bg-border rounded-full px-4 py-1.5 text-xs"
            >
              查看专注记录
            </button>
          </div>
          {slices.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {slices.map((slice, i) => (
                <li key={slice.name} className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: sliceColor(i) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{slice.name}</span>
                    <span className="text-muted block text-xs">{formatLong(slice.seconds)}</span>
                  </span>
                  <span className="font-serif text-sm tabular-nums">
                    {(slice.share * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={
            <span>
              月度专注统计{" "}
              <span className="text-muted ml-1 font-normal">
                {month.year}年{String(month.month).padStart(2, "0")}月
              </span>
            </span>
          }
          extra={
            <Stepper
              label="月"
              onStep={(step) =>
                setMonth((m) => {
                  const index = m.year * 12 + m.month - 1 + step;
                  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
                })
              }
            />
          }
        >
          <AreaChart points={monthSeries(list, month.year, month.month)} labelEvery={5} />
        </Card>

        <Card
          title={
            <span>
              年度专注统计 <span className="text-muted ml-1 font-normal">{year}年</span>
            </span>
          }
          extra={<Stepper label="年" onStep={(step) => setYear((y) => y + step)} />}
        >
          <AreaChart points={yearSeries(list, year)} labelEvery={1} />
        </Card>
      </div>

      {records && (
        <SessionList
          list={all.filter((s) => s.data.day >= from && s.data.day <= to)}
          onClose={() => setRecords(false)}
        />
      )}
    </div>
  );
}
