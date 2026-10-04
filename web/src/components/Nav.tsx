import { AlignLeft, BookOpen, CircleUser, Sun, Timer } from "lucide-react";
import { navigate, type Route } from "../router";

const ITEMS = [
  { name: "today", label: "今天", Icon: Sun, route: { name: "today", day: null } },
  { name: "index", label: "索引", Icon: AlignLeft, route: { name: "index", query: "" } },
  { name: "book", label: "本子", Icon: BookOpen, route: { name: "book", year: null, day: null } },
  { name: "timer", label: "计时", Icon: Timer, route: { name: "timer" } },
  { name: "me", label: "我的", Icon: CircleUser, route: { name: "me" } },
] as const satisfies readonly { name: string; label: string; route: Route; Icon: unknown }[];

const SECTION: Record<Route["name"], (typeof ITEMS)[number]["name"]> = {
  today: "today",
  index: "index",
  tag: "index",
  book: "book",
  timer: "timer",
  stats: "timer",
  me: "me",
};

/** Bottom bar on phones, a rail on the left on wide screens. */
export function Nav({ route }: { route: Route }) {
  const current = SECTION[route.name];
  return (
    <nav
      aria-label="主导航"
      className="border-border bg-surface/95 safe-bottom fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur lg:inset-y-0 lg:right-auto lg:w-24 lg:border-t-0 lg:border-r lg:pt-6"
    >
      <ul className="mx-auto flex max-w-xl justify-around px-2 py-1.5 lg:flex-col lg:items-center lg:justify-start lg:gap-3">
        {ITEMS.map(({ name, label, Icon, route: target }) => {
          const active = current === name;
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => navigate(target)}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className="group flex flex-col items-center gap-0.5 px-1"
              >
                <span
                  className={`flex h-9 w-14 items-center justify-center rounded-full transition-colors ${
                    active ? "bg-accent-soft text-accent-ink" : "text-muted group-hover:text-text"
                  }`}
                >
                  <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <span
                  className={`hidden text-[11px] lg:block ${active ? "text-accent-ink" : "text-muted"}`}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
