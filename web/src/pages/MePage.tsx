import { Check, Cloud, CloudOff, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SettingsData } from "@shared/records";
import { ColorPicker } from "../components/ColorPicker";
import { CaseColorPicker, CoverPicker } from "../components/CoverPicker";
import { useApp } from "../context";
import { readLocal, writeLocal } from "../hooks";
import {
  applyListSize,
  LIST_SIZE_KEY,
  LIST_SIZES,
  listLeading,
  parseListSize,
} from "../lib/list-size";
import { getSettings, saveSettings } from "../lib/model";
import { DEFAULT_ACCENT } from "../lib/theme";
import { formatClock, formatFullDay, dayKey } from "../lib/time";
import type { Conflict } from "../lib/sync";

const THEMES: { value: SettingsData["theme"]; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
];

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="border-border border-t py-5">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {hint && <p className="text-muted mb-3 text-xs">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

/** What a change that did not make it to the server said, in words. */
function describe(conflict: Conflict): string {
  const data = conflict.discarded.data as { text?: unknown; name?: unknown } | null;
  const what =
    typeof data?.text === "string"
      ? `「${data.text}」`
      : typeof data?.name === "string"
        ? `「${data.name}」`
        : "";
  const kinds: Record<string, string> = {
    task: "任务",
    tag: "标签",
    session: "专注记录",
    timer: "计时",
    settings: "设置",
    cover: "封面",
  };
  const action = conflict.discarded.deleted ? "删除" : "修改";
  return `${action}${kinds[conflict.kind] ?? ""}${what}`;
}

export function MePage() {
  const { engine, me, today } = useApp();
  const settings = getSettings(engine);
  const state = engine.getState();
  const status = engine.getStatus();
  const pending = Object.keys(state.pending).length;
  const [syncing, setSyncing] = useState(false);
  const [listSize, setListSize] = useState(() => parseListSize(readLocal(LIST_SIZE_KEY)));
  const chooseListSize = (px: number) => {
    setListSize(px);
    writeLocal(LIST_SIZE_KEY, String(px));
    applyListSize(px);
  };

  const syncText =
    status === "offline"
      ? `离线中，${pending} 处改动等联网后同步`
      : pending > 0
        ? `${pending} 处改动正在同步`
        : state.lastSyncAt
          ? `已同步 ${dayKey(state.lastSyncAt) === today ? "" : formatFullDay(dayKey(state.lastSyncAt), today) + " "}${formatClock(state.lastSyncAt)}`
          : "还没同步过";

  return (
    <div className="mx-auto max-w-xl px-5 pb-6 lg:px-10">
      <header className="flex items-center gap-4 pt-6 pb-5">
        <div className="bg-accent text-accent-fg flex h-14 w-14 items-center justify-center rounded-full font-serif text-2xl">
          {(me.name || me.username).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-medium">{me.name || me.username}</h1>
          <p className="text-muted flex items-center gap-1.5 text-xs">
            {status === "offline" ? (
              <CloudOff size={13} aria-hidden="true" />
            ) : (
              <Cloud size={13} aria-hidden="true" />
            )}
            <span role="status">{syncText}</span>
            <button
              type="button"
              aria-label="立即同步"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                await engine.sync();
                setSyncing(false);
              }}
              className="hover:text-text ml-1 rounded-full p-1"
            >
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} aria-hidden="true" />
            </button>
          </p>
        </div>
      </header>

      <Section title="主题色" hint="标签、按钮和导航都用这个颜色。可以点选，也可以输入色号。">
        <ColorPicker
          value={settings.accent ?? DEFAULT_ACCENT}
          onChange={(color) =>
            saveSettings(engine, { accent: color === DEFAULT_ACCENT ? null : color })
          }
        />
        <div className="bg-surface-2 mt-4 flex items-center gap-3 rounded-xl px-4 py-3 text-sm">
          <span className="bg-accent text-accent-fg rounded-full px-3 py-1 text-xs">按钮</span>
          <span className="text-accent-ink">#标签</span>
          <span className="bg-accent-soft text-accent-ink rounded-full px-3 py-1 text-xs">
            选中
          </span>
        </div>
      </Section>

      <Section title="外观">
        <div
          className="bg-surface-2 grid grid-cols-3 rounded-xl p-1"
          role="radiogroup"
          aria-label="外观"
        >
          {THEMES.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={settings.theme === value}
              onClick={() => saveSettings(engine, { theme: value })}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm ${
                settings.theme === value ? "bg-surface shadow-sm" : "text-muted"
              }`}
            >
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="清单字号" hint="只影响这台设备。">
        <div
          className="bg-surface-2 grid grid-cols-4 rounded-xl p-1"
          role="radiogroup"
          aria-label="清单字号"
        >
          {LIST_SIZES.map(({ px, label }) => (
            <button
              key={px}
              type="button"
              role="radio"
              aria-checked={listSize === px}
              onClick={() => chooseListSize(px)}
              className={`rounded-lg py-2 text-sm ${
                listSize === px ? "bg-surface shadow-sm" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p
          className="border-border mt-3 rounded-xl border px-4 py-2.5"
          style={{ fontSize: listSize, lineHeight: `${listLeading(listSize)}px` }}
        >
          R 21-1-3 复盘 <span className="text-accent-ink">#阅读</span>
        </p>
      </Section>

      <Section title="封面颜色" hint="本子书壳和书脊的颜色。">
        <CaseColorPicker />
      </Section>

      <Section title="本子封面">
        <CoverPicker />
      </Section>

      {state.conflicts.length > 0 && (
        <Section title="没能同步的改动" hint="别的设备先改了同一条，这里的改动没有保存。">
          <ul className="space-y-2">
            {state.conflicts.map((conflict) => (
              <li
                key={`${conflict.kind}/${conflict.id}/${conflict.at}`}
                className="bg-surface-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{describe(conflict)}</span>
                <span className="text-muted text-xs">{formatClock(conflict.at)}</span>
                <button
                  type="button"
                  aria-label="知道了"
                  onClick={() => engine.dismissConflict(conflict)}
                  className="text-muted hover:text-text rounded-full p-1"
                >
                  <Check size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-muted pt-4 text-center text-[11px]">Moli Todo {__APP_VERSION__}</p>
    </div>
  );
}
