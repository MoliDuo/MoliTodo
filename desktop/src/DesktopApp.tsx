import { ChevronDown, ChevronUp, Settings as SettingsIcon, X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Settings } from "@web/components/Settings";
import { SyncBadge } from "@web/components/SyncBadge";
import { TodoBody } from "@web/components/TodoBody";
import { useAutoSync } from "@web/useAutoSync";
import { DOWNLOAD_URL, REFRESH_MS } from "./config";
import { LoginDialog } from "./Login";
import type { Platform, WindowControl } from "./platform";
import type { Session } from "./session";
import { isLocked, type UpdateController, type UpdateState } from "./updates";

/** Height of the title bar: what is left of the window when it is collapsed. */
export const COLLAPSED_HEIGHT = 44;
const DEFAULT_EXPANDED_HEIGHT = 480;

function AccountSection(props: { session: Session; onSignIn: () => void; onChanged: () => void }) {
  const { session } = props;
  const [asking, setAsking] = useState(false);
  const account = session.settings().account;
  const signedIn = session.tokens.signedIn;

  const signOut = async (clearLocal: boolean) => {
    await session.signOut({ clearLocal });
    setAsking(false);
    props.onChanged();
  };

  return (
    <section className="border-border mt-4 border-t pt-3">
      <h3 className="mb-1 font-medium">账号</h3>
      {signedIn ? (
        <>
          <p className="text-muted mb-2 text-sm">
            已登录：{account?.name ?? account?.username ?? "…"}
          </p>
          {asking ? (
            <div className="flex flex-col items-start gap-1 text-sm">
              <p className="text-muted">退出后，这台电脑上的任务怎么处理？</p>
              <button type="button" className="text-accent" onClick={() => void signOut(false)}>
                保留任务，只退出登录
              </button>
              <button type="button" className="text-danger" onClick={() => void signOut(true)}>
                退出并删除这台电脑上的任务
              </button>
              <button type="button" className="text-muted" onClick={() => setAsking(false)}>
                取消
              </button>
            </div>
          ) : (
            <button type="button" className="text-accent text-sm" onClick={() => setAsking(true)}>
              退出登录
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-muted mb-2 text-sm">未登录：任务只保存在这台电脑上。</p>
          <button type="button" className="text-accent text-sm" onClick={props.onSignIn}>
            登录
          </button>
        </>
      )}
    </section>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** The answer to 「检查更新…」 (standard 007, 7.4.4). */
function UpdateMessage({ state, updates }: { state: UpdateState; updates: UpdateController }) {
  if (state.phase !== "message") return null;
  return (
    <div
      role="status"
      aria-label="更新提示"
      className="bg-surface-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
    >
      <span className="flex-1">{state.text}</span>
      <button type="button" className="text-muted" onClick={() => updates.dismiss()}>
        知道了
      </button>
    </div>
  );
}

/** Takes the place of the list while this version has to be updated: there is no 「稍后」. */
function UpdateGate(props: {
  state: Extract<UpdateState, { phase: "required" | "installing" | "outdated" }>;
  updates: UpdateController;
  onDownload: () => void;
}) {
  const { state, updates } = props;
  const error = state.phase === "installing" ? undefined : state.error;
  return (
    <main
      role="status"
      aria-label="需要更新"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm"
    >
      {state.phase === "outdated" ? (
        <p className="font-medium">这个版本已不再支持，请更新后继续使用。</p>
      ) : (
        <>
          <p className="font-medium">需要更新到 {state.offer.version} 才能继续使用。</p>
          {state.offer.notes && (
            <p className="text-muted text-xs whitespace-pre-line">{state.offer.notes}</p>
          )}
        </>
      )}
      <p className="text-muted text-xs">这台电脑上的任务都还在，更新后会接着同步。</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {state.phase === "installing" && (
        <p>正在下载并安装 {state.offer.version}…完成后会自动重启。</p>
      )}
      {state.phase === "required" && (
        <button
          type="button"
          className="bg-accent text-accent-fg self-start rounded-lg px-3 py-1.5"
          onClick={() => void updates.install()}
        >
          立即更新
        </button>
      )}
      {state.phase === "outdated" && (
        <span className="flex gap-3">
          <button
            type="button"
            className="bg-accent text-accent-fg rounded-lg px-3 py-1.5"
            onClick={props.onDownload}
          >
            打开下载页
          </button>
          <button
            type="button"
            className="text-accent"
            onClick={() => void updates.checkNow({ manual: true })}
          >
            重新检查
          </button>
        </span>
      )}
    </main>
  );
}

const IDLE: UpdateState = { phase: "idle" };
const NO_UPDATES = { subscribe: () => () => undefined, getState: () => IDLE };

export interface DesktopAppProps {
  session: Session;
  platform: Platform;
  windowControl: WindowControl;
  now?: () => number;
  version?: string;
  /** Absent in a build that cannot update. */
  updates?: UpdateController;
}

export function DesktopApp({
  session,
  platform,
  windowControl,
  now = Date.now,
  version,
  updates,
}: DesktopAppProps) {
  const { engine } = session.store;
  useAutoSync(session.store, { refreshMs: REFRESH_MS });

  const [collapsed, setCollapsed] = useState(session.settings().collapsed);
  const [permanentTop, setPermanentTop] = useState(session.settings().permanentTop);
  const [autostart, setAutostart] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [, refreshAccount] = useState(0);
  const status = engine.getStatus();
  const signedIn = session.tokens.signedIn;
  const updateState = useSyncExternalStore(
    (updates ?? NO_UPDATES).subscribe,
    (updates ?? NO_UPDATES).getState
  );
  const locked = isLocked(updateState);

  useEffect(() => {
    if (!updates) return;
    updates.start();
    const stopListening = windowControl.onCheckUpdates(
      () => void updates.checkNow({ manual: true })
    );
    return () => {
      updates.stop();
      stopListening();
    };
  }, [updates, windowControl]);

  // The server turned this version away: look for the update right away and lock the app.
  useEffect(() => {
    if (status === "upgrade") void updates?.serverRejected();
  }, [status, updates]);

  // A required update has to be seen: open the window up and close what covers it. The saved choice to
  // keep the window collapsed stays as it was.
  useEffect(() => {
    if (!locked) return;
    setSettingsOpen(false);
    setLoginOpen(false);
    if (!collapsed) return;
    setCollapsed(false);
    void windowControl.setCollapsed(
      false,
      session.settings().bounds?.height ?? DEFAULT_EXPANDED_HEIGHT
    );
  }, [locked, collapsed, windowControl, session]);

  useEffect(() => {
    void windowControl.isAutostart().then(setAutostart, () => undefined);
    return windowControl.onTrayChange((change) => {
      if (change.permanentTop !== undefined) {
        setPermanentTop(change.permanentTop);
        session.updateSettings({ permanentTop: change.permanentTop });
      }
      if (change.autostart !== undefined) setAutostart(change.autostart);
    });
  }, [windowControl, session]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    session.updateSettings({ collapsed: next });
    void windowControl.setCollapsed(
      next,
      session.settings().bounds?.height ?? DEFAULT_EXPANDED_HEIGHT
    );
  };

  const changePermanentTop = (on: boolean) => {
    setPermanentTop(on);
    session.updateSettings({ permanentTop: on });
    void windowControl.setPermanentTop(on);
  };

  const changeAutostart = (on: boolean) => {
    setAutostart(on);
    void windowControl.setAutostart(on).catch(() => setAutostart(!on));
  };

  const signedInNow = useCallback(() => {
    setLoginOpen(false);
    refreshAccount((n) => n + 1);
    void engine.sync();
  }, [engine]);

  const needsLogin = !signedIn || status === "auth";

  return (
    <div className="bg-bg flex h-full flex-col">
      <header
        data-tauri-drag-region
        className="border-border flex shrink-0 items-center gap-2 border-b px-3"
        style={{ height: COLLAPSED_HEIGHT }}
      >
        {!locked && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "展开" : "折叠"}
            className="text-muted hover:text-text"
          >
            {collapsed ? (
              <ChevronDown size={16} aria-hidden="true" />
            ) : (
              <ChevronUp size={16} aria-hidden="true" />
            )}
          </button>
        )}
        <h1 data-tauri-drag-region className="flex-1 text-sm font-semibold">
          Moli Todo
        </h1>
        {!locked && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            className="text-muted hover:text-text"
          >
            <SettingsIcon size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void session.flush().then(() => windowControl.hide());
          }}
          aria-label="隐藏"
          className="text-muted hover:text-text"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {!collapsed && locked && updates && (
        <UpdateGate
          state={updateState}
          updates={updates}
          onDownload={() => void platform.openUrl(DOWNLOAD_URL)}
        />
      )}

      {!collapsed && !locked && (
        <>
          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {needsLogin && (
              <div
                role="status"
                aria-label="登录提示"
                className="bg-surface-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              >
                <span className="flex-1">
                  {signedIn
                    ? "登录已失效，改动先保存在这台电脑上。"
                    : "未登录：任务只保存在这台电脑上。"}
                </span>
                <button type="button" className="text-accent" onClick={() => setLoginOpen(true)}>
                  登录
                </button>
              </div>
            )}
            {updates && !settingsOpen && <UpdateMessage state={updateState} updates={updates} />}
            <TodoBody engine={engine} now={now()} />
          </main>
          <footer className="border-border shrink-0 border-t px-3 py-1">
            <SyncBadge
              status={status}
              lastSyncAt={engine.getState().lastSyncAt}
              onSync={() => void engine.sync()}
            />
          </footer>
        </>
      )}

      {settingsOpen && (
        <Settings
          engine={engine}
          username={
            session.settings().account?.name ?? session.settings().account?.username ?? "未登录"
          }
          findLegacy={platform.readLegacyStore}
          onClose={() => setSettingsOpen(false)}
        >
          <Toggle label="窗口永久置顶" checked={permanentTop} onChange={changePermanentTop} />
          <Toggle label="开机自启" checked={autostart} onChange={changeAutostart} />
          <AccountSection
            session={session}
            onSignIn={() => {
              setSettingsOpen(false);
              setLoginOpen(true);
            }}
            onChanged={() => refreshAccount((n) => n + 1)}
          />
          {updates && <UpdateMessage state={updateState} updates={updates} />}
          {updates && (
            <button
              type="button"
              className="text-accent mt-3 text-sm"
              onClick={() => void updates.checkNow({ manual: true })}
            >
              检查更新…
            </button>
          )}
          {version && <p className="text-muted mt-2 text-xs">版本 {version}</p>}
        </Settings>
      )}

      {loginOpen && (
        <LoginDialog
          session={session}
          platform={platform}
          onDone={signedInNow}
          onClose={() => setLoginOpen(false)}
        />
      )}
    </div>
  );
}
