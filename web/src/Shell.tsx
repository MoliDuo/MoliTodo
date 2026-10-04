import { CloudOff } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { MeResponse } from "@shared/api";
import { signInUrl } from "./api";
import { Nav } from "./components/Nav";
import { AppContext, type AppContextValue } from "./context";
import { useMediaQuery, useNow } from "./hooks";
import { getSettings } from "./lib/model";
import { applyTheme } from "./lib/theme";
import { dayKey } from "./lib/time";
import { BookPage } from "./pages/BookPage";
import { IndexPage } from "./pages/IndexPage";
import { MePage } from "./pages/MePage";
import { StatsPage } from "./pages/StatsPage";
import { TagPage } from "./pages/TagPage";
import { TimerPage } from "./pages/TimerPage";
import { TodayPage } from "./pages/TodayPage";
import { parseRoute, useHash } from "./router";
import type { TodoStore } from "./store";
import { useAutoSync } from "./useAutoSync";

const REFRESH_MS = 60_000;
const goToSignIn = () => window.location.assign(signInUrl(window.location));

const RELOADED_AT_KEY = "moli-todo:reloaded-for-upgrade";
/** At most one automatic reload in this long, so a server set wrong cannot make the page reload forever. */
const UPGRADE_RELOAD_GAP_MS = 5 * 60 * 1000;

/**
 * The server says this page is too old (426): load the current one. Inside the gap after the last automatic
 * reload, a notice asks the person to reload instead.
 */
const reloadForUpgrade = () => {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT_KEY));
    if (last && Date.now() - last < UPGRADE_RELOAD_GAP_MS) return;
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    // No storage, so no way to stop a loop: leave it to the notice.
    return;
  }
  window.location.reload();
};

export function Shell({
  store,
  me,
  clock = Date.now,
}: {
  store: TodoStore;
  me: MeResponse;
  clock?: () => number;
}) {
  const { engine } = store;
  const tick = useAutoSync(store, {
    refreshMs: REFRESH_MS,
    onAuthLost: goToSignIn,
    onUpgradeRequired: reloadForUpgrade,
  });
  const now = useNow(clock, 20_000);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const settings = getSettings(engine);
  useEffect(
    () => applyTheme({ accent: settings.accent, theme: settings.theme, cover: "" }, systemDark),
    [settings.accent, settings.theme, systemDark]
  );
  const route = parseRoute(useHash());
  const today = dayKey(now);
  const context = useMemo<AppContextValue>(
    () => ({ engine, me, now, today, tick }),
    [engine, me, now, today, tick]
  );
  const status = engine.getStatus();

  return (
    <AppContext.Provider value={context}>
      <div className="bg-surface text-text min-h-dvh lg:pl-24">
        {(status === "offline" || status === "upgrade") && (
          <div
            role="status"
            className="bg-surface-2 text-muted flex items-center justify-center gap-2 px-4 py-1.5 text-xs"
          >
            <CloudOff size={14} aria-hidden="true" />
            {status === "offline"
              ? "离线中，改动已保存在这里，联网后自动同步"
              : "版本太旧，请刷新页面"}
          </div>
        )}
        <main className="pb-24 lg:pb-8">
          {route.name === "today" && <TodayPage day={route.day ?? today} />}
          {route.name === "index" && <IndexPage query={route.query} />}
          {route.name === "tag" && <TagPage tag={route.tag} />}
          {route.name === "book" && <BookPage year={route.year} day={route.day} />}
          {route.name === "timer" && <TimerPage clock={clock} />}
          {route.name === "stats" && <StatsPage />}
          {route.name === "me" && <MePage />}
        </main>
        <Nav route={route} />
      </div>
    </AppContext.Provider>
  );
}
