import { BookMarked, ChevronDown, Palette } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BookStage, type StageGeometry } from "../components/BookStage";
import { Calendar } from "../components/Calendar";
import { CaseColorPicker, CoverPicker } from "../components/CoverPicker";
import { Sheet } from "../components/Sheet";
import { TaskLine, type TagColors } from "../components/TaskText";
import { useApp } from "../context";
import { useMediaQuery } from "../hooks";
import {
  makeBook,
  pagesAt,
  positionOf,
  type BookPage as Page,
  type Face,
  type Layout,
} from "../lib/book";
import { coverSrc } from "../lib/covers";
import { getSettings, totalMinutes, uploadedCovers } from "../lib/model";
import { dayParts, formatDuration, formatMonthDay, formatWeekday } from "../lib/time";
import { navigate } from "../router";
import { useTagColors } from "../useTagColors";

type Phase = "closed" | "opening" | "open" | "closing-start" | "closing";

const OPEN_MS = 1100;
const CLOSE_MS = 1000;
/** The case shows this far around the pages. */
const CASE = 8;
const FALLBACK = { width: 375, height: 640 };

/** Page size and where the spine sits, for the space there is. */
export function bookGeometry(width: number, height: number, layout: Layout): StageGeometry {
  if (layout === "spread") {
    const w = Math.floor(Math.min((width - 96) / 2, (height - 48) / 1.38, 460));
    const h = Math.floor(Math.min(w * 1.38, height - 48));
    return { w, h, x: Math.round(width / 2), y: Math.round((height - h) / 2) };
  }
  // One page, with a sliver of the page before it showing on the left.
  const w = Math.floor(Math.min(width - 34, (height - 36) / 1.3, 520));
  const h = Math.floor(Math.min(w * 1.52, height - 36));
  const x = Math.round(Math.max(20, (width - w) / 2 + 6));
  return { w, h, x, y: Math.round((height - h) / 2) };
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState(FALLBACK);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** One day as a page of the book. */
function DayPage({
  page,
  side,
  tagColors,
}: {
  page: Page;
  side: "left" | "right";
  tagColors: TagColors;
}) {
  const minutes = totalMinutes(page.tasks);
  return (
    <div
      className={`paper book-page absolute inset-0 flex flex-col overflow-hidden px-[8%] pt-[6%] pb-[5%] ${side}`}
    >
      <div className="text-muted flex items-start justify-between text-[11px]">
        <span>{formatWeekday(page.day)}</span>
        <span className="font-serif tabular-nums">{page.number}</span>
      </div>
      <h2 className="mt-0.5 font-serif text-[21px] leading-7 font-semibold">
        {formatMonthDay(page.day)}
      </h2>
      <div className="border-border/80 mt-2 mb-3 border-b" />
      <div className="min-h-0 flex-1 space-y-[3px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_88%,transparent)]">
        {page.tasks.map((task) => (
          <TaskLine key={task.id} task={task.data} tagColors={tagColors} small />
        ))}
      </div>
      <div className="border-border/80 text-muted mt-2 border-t pt-2 font-serif text-[13px]">
        {minutes > 0 ? formatDuration(minutes) : " "}
      </div>
    </div>
  );
}

function Endpaper({ side, year }: { side: "left" | "right"; year: number }) {
  return (
    <div className={`endpaper book-page absolute inset-0 flex items-center justify-center ${side}`}>
      {side === "left" && (
        <span className="font-serif text-sm tracking-[0.3em] text-white/55">{year}</span>
      )}
    </div>
  );
}

/** The cover: her painting on the board, the case's colour down the spine, the year on the front. */
function Cover({ src, year, style }: { src: string; year: number; style: CSSProperties }) {
  return (
    <div className="book-cover absolute" style={style}>
      <div className="book-cover-front">
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        <div className="book-cover-spine" />
        <div className="book-cover-sheen" />
        <span className="absolute inset-x-0 bottom-[11%] text-center font-serif text-[2.2rem] font-bold tracking-wider text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.45)]">
          {year}
        </span>
      </div>
      <div className="book-cover-back endpaper" />
    </div>
  );
}

export function BookPage({
  year: routeYear,
  day: routeDay,
}: {
  year: number | null;
  day: string | null;
}) {
  const { engine, today, tick } = useApp();
  const tagColors = useTagColors();
  const thisYear = dayParts(today).year;
  const year = routeYear ?? thisYear;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const book = useMemo(() => makeBook(engine, year, thisYear), [engine, year, thisYear, tick]);
  const wide = useMediaQuery("(min-width: 1024px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const layout: Layout = wide ? "spread" : "single";
  const area = useRef<HTMLDivElement>(null);
  const size = useSize(area);
  const geometry = bookGeometry(size.width, size.height, layout);
  const [phase, setPhase] = useState<Phase>(routeDay ? "open" : "closed");
  const [covers, setCovers] = useState(false);
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settings = getSettings(engine);
  const src = coverSrc(settings.cover, uploadedCovers(engine), settings.hiddenCovers);

  const n = book.pages.length;
  const indexOfDay = (day: string | null) =>
    day ? book.pages.findIndex((p) => p.day === day) : -1;
  const todayIndex = indexOfDay(today);
  const shownIndex =
    indexOfDay(routeDay) >= 0 ? indexOfDay(routeDay) : todayIndex >= 0 ? todayIndex : n - 1;
  const position = positionOf(layout, Math.max(0, shownIndex));

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  // Another year starts closed.
  const lastYear = useRef(year);
  useEffect(() => {
    if (lastYear.current !== year) setPhase(routeDay ? "open" : "closed");
    lastYear.current = year;
  }, [year, routeDay]);

  const later = (ms: number, next: Phase) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase(next), ms);
  };
  const show = (index: number) =>
    navigate({ name: "book", year: routeYear, day: book.pages[index]?.day ?? null }, true);
  const open = (index = shownIndex) => {
    if (n === 0) return;
    show(index);
    if (reducedMotion) return setPhase("open");
    setPhase("opening");
    later(OPEN_MS, "open");
  };
  const close = () => {
    if (reducedMotion) return setPhase("closed");
    setPhase("closing-start");
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase("closing")));
    later(CLOSE_MS, "closed");
  };

  const writtenDays = useMemo(() => new Set(book.days), [book]);
  // The day picker closes on a tap outside it or Esc.
  useEffect(() => {
    if (!picking) return;
    const away = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setPicking(false);
    };
    const esc = (event: KeyboardEvent) => event.key === "Escape" && setPicking(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [picking]);

  const shut = phase === "closed" || phase === "closing";
  /** Turns to a day: in this year the book opens there (with the cover turning if it was shut). */
  const pickDay = (day: string) => {
    setPicking(false);
    const y = dayParts(day).year;
    navigate({ name: "book", year: y === thisYear ? null : y, day }, y === year);
    // Another year's book starts open at the day of the route.
    if (y !== year || !shut) return;
    if (reducedMotion) return setPhase("open");
    setPhase("opening");
    later(OPEN_MS, "open");
  };
  // Closed, the stage is shrunk and moved so the right-hand half (the cover) sits in the upper middle.
  const caseW = geometry.w + CASE + 2;
  const caseH = geometry.h + CASE * 2;
  const scale = Math.min((size.width * 0.6) / caseW, (size.height * 0.56) / caseH, 250 / caseW);
  const coverLeft = (size.width - caseW * scale) / 2;
  const coverTop = Math.max(16, size.height * 0.07);
  const closedTransform = `translate(${coverLeft - geometry.x * scale}px, ${
    coverTop - (geometry.y - CASE) * scale
  }px) scale(${scale})`;
  const motion = reducedMotion ? "none" : undefined;

  const renderFace = (face: Face, side: "left" | "right"): ReactNode => {
    if (face.type === "endpaper") return <Endpaper side={side} year={year} />;
    if (face.type === "page") {
      const page = book.pages[face.index];
      return page ? (
        <DayPage page={page} side={side} tagColors={tagColors} />
      ) : (
        <Endpaper side={side} year={year} />
      );
    }
    const ghost = face.ghost === null ? undefined : book.pages[face.ghost];
    return (
      <div className={`paper book-page absolute inset-0 overflow-hidden ${side}`}>
        {ghost && (
          <div className="absolute inset-0 -scale-x-100 opacity-[0.07]" aria-hidden="true">
            <DayPage page={ghost} side={side} tagColors={tagColors} />
          </div>
        )}
      </div>
    );
  };

  const shown = pagesAt(layout, n, position)
    .map((index) => book.pages[index])
    .filter((page): page is Page => Boolean(page));

  return (
    <div className="flex flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-4 pb-2 lg:px-10">
        <div className="relative" ref={picker}>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            aria-label={`${year} 年，选一天`}
            className="flex items-center gap-1 font-serif text-[26px] font-bold"
          >
            {year}
            <ChevronDown size={16} className="text-muted mt-1" aria-hidden="true" />
          </button>
          {picking && (
            <div
              role="dialog"
              aria-label="选一天"
              className="bg-surface border-border absolute top-full left-0 z-40 mt-1 w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border p-3 shadow-lg"
            >
              <Calendar
                selected={book.pages[shownIndex]?.day ?? today}
                today={today}
                marked={writtenDays}
                enabled={writtenDays}
                years={book.years}
                onPick={pickDay}
              />
            </div>
          )}
        </div>
        <div className="text-muted flex items-center gap-1">
          {!shut && (
            <button
              type="button"
              onClick={close}
              className="hover:text-text flex items-center gap-1 rounded-full px-3 py-2 text-sm"
            >
              <BookMarked size={18} strokeWidth={1.75} aria-hidden="true" /> 合上
            </button>
          )}
          <button
            type="button"
            aria-label="换封面"
            onClick={() => setCovers(true)}
            className="hover:text-text rounded-full p-2"
          >
            <Palette size={21} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={area}
        className="relative h-[calc(100dvh-8.5rem)] overflow-hidden lg:h-[calc(100dvh-5rem)]"
        aria-label={
          shut ? "本子封面" : `本子，${shown.map((p) => formatMonthDay(p.day)).join("、")}`
        }
        role="region"
      >
        <div
          className={`book-world absolute inset-0 origin-top-left phase-${phase} ${phase === "open" ? "" : "pointer-events-none"}`}
          style={{ transform: shut ? closedTransform : "none", transition: motion }}
        >
          {n > 0 && (
            <BookStage
              layout={layout}
              pages={n}
              position={position}
              geometry={geometry}
              reducedMotion={reducedMotion}
              renderFace={renderFace}
              onPosition={(next) => {
                const indexes = pagesAt(layout, n, next);
                show(indexes[indexes.length - 1] ?? 0);
              }}
              onTapPage={(index) => {
                const day = book.pages[index]?.day;
                if (day) navigate({ name: "today", day: day === today ? null : day });
              }}
              under={
                <>
                  <div
                    className="book-case book-left absolute rounded-l-xl"
                    style={{
                      left: -geometry.w - CASE,
                      top: -CASE,
                      width: geometry.w + CASE,
                      height: caseH,
                    }}
                  />
                  <div
                    className="book-case absolute rounded-r-xl"
                    style={{ left: 0, top: -CASE, width: caseW, height: caseH }}
                  />
                </>
              }
              over={
                phase !== "open" && (
                  <Cover
                    src={src}
                    year={year}
                    style={{
                      left: 0,
                      top: -CASE,
                      width: caseW,
                      height: caseH,
                      transform:
                        phase === "opening" || phase === "closing-start"
                          ? "rotateY(-180deg)"
                          : "none",
                      transition: phase === "closing-start" ? "none" : motion,
                    }}
                  />
                )
              }
            />
          )}
        </div>

        {n > 0 && phase === "closed" && (
          <button
            type="button"
            aria-label={todayIndex >= 0 && year === thisYear ? "打开今天" : "打开本子"}
            onClick={() => open()}
            className="absolute rounded-xl"
            style={{ left: coverLeft, top: coverTop, width: caseW * scale, height: caseH * scale }}
          />
        )}

        {n === 0 && (
          <div className="absolute inset-0 flex flex-col items-center pt-[7%]">
            <div className="book-cover-front relative aspect-[600/860] w-[min(58%,230px)] overflow-hidden rounded-r-xl rounded-l-sm shadow-xl">
              <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="book-cover-spine" />
              <span className="absolute inset-x-0 bottom-[11%] text-center font-serif text-4xl font-bold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.45)]">
                {year}
              </span>
            </div>
          </div>
        )}

        {shut && (
          <div
            className={`absolute inset-x-0 flex flex-col items-center transition-opacity duration-300 ${phase === "closed" ? "opacity-100" : "opacity-0"}`}
            style={{
              top: n > 0 ? coverTop + caseH * scale + 28 : "auto",
              bottom: n > 0 ? undefined : "12%",
            }}
          >
            <div className="flex items-center">
              <div className="px-8 text-center">
                <p className="font-serif text-2xl font-semibold">{n}</p>
                <p className="text-muted text-xs">已写</p>
              </div>
              <div className="bg-border h-8 w-px" />
              <div className="px-8 text-center">
                <p className="font-serif text-2xl font-semibold">{book.lines}</p>
                <p className="text-muted text-xs">条</p>
              </div>
            </div>
            {n > 0 ? (
              <button
                type="button"
                onClick={() => open()}
                className="text-accent-ink hover:bg-accent-soft mt-5 rounded-full px-5 py-2 text-sm"
              >
                {todayIndex >= 0 && year === thisYear ? "打开今天" : "打开本子"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate({ name: "today", day: null })}
                className="text-accent-ink hover:bg-accent-soft mt-5 rounded-full px-5 py-2 text-sm"
              >
                去写第一天
              </button>
            )}
          </div>
        )}
      </div>

      {covers && (
        <Sheet title="本子封面" onClose={() => setCovers(false)} wide>
          <h3 className="text-muted mb-2 text-xs">封面颜色</h3>
          <CaseColorPicker />
          <h3 className="text-muted mt-5 mb-2 text-xs">封面图片</h3>
          <CoverPicker />
        </Sheet>
      )}
    </div>
  );
}
