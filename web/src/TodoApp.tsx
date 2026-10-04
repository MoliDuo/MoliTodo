import { Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import type { MeResponse } from "@shared/api";
import { Settings } from "./components/Settings";
import { SyncBadge } from "./components/SyncBadge";
import { TodoBody } from "./components/TodoBody";
import { signInUrl } from "./api";
import type { TodoStore } from "./store";
import { useAutoSync } from "./useAutoSync";

const REFRESH_MS = 60_000;

const goToSignIn = () => window.location.assign(signInUrl(window.location));

const RELOADED_AT_KEY = "moli-todo:reloaded-for-upgrade";
/** At most one automatic reload in this long, so a server set wrong cannot make the page reload forever. */
const UPGRADE_RELOAD_GAP_MS = 5 * 60 * 1000;

/**
 * The server says this page is too old (426): load the current one. Inside the gap after the last automatic
 * reload, the badge asks the person to reload instead.
 */
const reloadForUpgrade = () => {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT_KEY));
    if (last && Date.now() - last < UPGRADE_RELOAD_GAP_MS) return;
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    // No storage, so no way to stop a loop: leave it to the badge.
    return;
  }
  window.location.reload();
};

export function TodoApp({
  store,
  me,
  now = Date.now,
}: {
  store: TodoStore;
  me: MeResponse;
  now?: () => number;
}) {
  const { engine } = store;
  useAutoSync(store, {
    refreshMs: REFRESH_MS,
    onAuthLost: goToSignIn,
    onUpgradeRequired: reloadForUpgrade,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Moli Todo</h1>
        <div className="flex items-center gap-3">
          <SyncBadge
            status={engine.getStatus()}
            lastSyncAt={engine.getState().lastSyncAt}
            onSync={() => void engine.sync()}
          />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            className="text-muted hover:text-text"
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <TodoBody engine={engine} now={now()} />

      {settingsOpen && (
        <Settings
          engine={engine}
          username={me.name ?? me.username}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
