import { ChevronDown, ChevronUp, Settings as SettingsIcon, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Settings } from "@web/components/Settings";
import { SyncBadge } from "@web/components/SyncBadge";
import { TodoBody } from "@web/components/TodoBody";
import { useAutoSync } from "@web/useAutoSync";
import { REFRESH_MS } from "./config";
import { LoginDialog } from "./Login";
import type { Platform, WindowControl } from "./platform";
import type { Session } from "./session";

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

export interface DesktopAppProps {
  session: Session;
  platform: Platform;
  windowControl: WindowControl;
  now?: () => number;
  version?: string;
}

export function DesktopApp({
  session,
  platform,
  windowControl,
  now = Date.now,
  version,
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
        <h1 data-tauri-drag-region className="flex-1 text-sm font-semibold">
          Moli Todo
        </h1>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
          className="text-muted hover:text-text"
        >
          <SettingsIcon size={16} aria-hidden="true" />
        </button>
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

      {!collapsed && (
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
          {version && <p className="text-muted mt-4 text-xs">版本 {version}</p>}
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
