// The only file that calls the window toolkit. Everything the app decides is in the other files, which
// work against the `Platform` and `WindowControl` interfaces and are tested without a window.

import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import {
  availableMonitors,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { COLLAPSED_HEIGHT } from "./DesktopApp";
import type { DataFile, Platform, WindowControl } from "./platform";
import type { Settings } from "./persistence";
import { UpdaterUnavailableError, type Updater } from "./updates";
import { clampToVisible, type Rect } from "./window-bounds";

export function createTauriPlatform(): Platform {
  return {
    readFile: (name: DataFile) => invoke<string | null>("read_data_file", { name }),
    writeFile: (name, text) => invoke<void>("write_data_file", { name, text }),
    quarantineFile: (name) => invoke<void>("quarantine_data_file", { name }),
    readLegacyStore: () => invoke<string | null>("read_legacy_store"),
    fetch: tauriFetch as typeof fetch,
    openUrl: (url) => openUrl(url),
  };
}

/** The update plugin is only built in when the app was given an update key (see `updates_enabled` on the Rust side). */
export function createTauriUpdater(): Updater {
  let found: Update | null = null;
  return {
    async check() {
      if (!(await invoke<boolean>("updates_enabled"))) throw new UpdaterUnavailableError();
      found = await check();
      return found ? { version: found.version, notes: found.body ?? "" } : null;
    },
    async install() {
      // Nothing found by the last check (it failed, or the release was withdrawn): say so, so the app stays locked.
      if (!found) throw new Error("no update to install");
      await found.downloadAndInstall();
      await invoke<void>("restart_app");
    },
    installBlocked: () => invoke<boolean>("install_blocked"),
  };
}

const BOUNDS_SAVE_DELAY_MS = 500;
const MIN_WIDTH = 280;

/**
 * Puts the window back where it was (kept on a screen that exists), applies the saved settings, shows it,
 * hides instead of closing, keeps the tray menu, and reports moves and resizes so they can be saved.
 */
export async function setUpWindow(options: {
  settings: Settings;
  onBounds: (bounds: Rect) => void;
}): Promise<WindowControl> {
  const win = getCurrentWindow();
  const { settings } = options;
  let permanentTop = settings.permanentTop;
  let collapsed = settings.collapsed;
  let expandedHeight = settings.bounds?.height ?? 480;
  const listeners = new Set<(change: { permanentTop?: boolean; autostart?: boolean }) => void>();
  const updateListeners = new Set<() => void>();

  // 1. Restore the position on a screen that still exists.
  if (settings.bounds) {
    const monitors = await availableMonitors();
    const screens = monitors.map((m) => ({
      x: m.workArea.position.x,
      y: m.workArea.position.y,
      width: m.workArea.size.width,
      height: m.workArea.size.height,
    }));
    const rect = clampToVisible(settings.bounds, screens);
    await win.setSize(
      new PhysicalSize(
        rect.width,
        collapsed ? Math.round(COLLAPSED_HEIGHT * (await win.scaleFactor())) : rect.height
      )
    );
    await win.setPosition(new PhysicalPosition(rect.x, rect.y));
    expandedHeight = rect.height;
  }
  await win.setAlwaysOnTop(permanentTop);
  await win.show();

  // 2. Closing hides; the tray (or a second launch) brings it back.
  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    await win.hide();
  });

  // 3. Save where the window is, after the person stops moving or resizing it.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reportBounds = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
      if (!collapsed) expandedHeight = size.height;
      options.onBounds({ x: position.x, y: position.y, width: size.width, height: expandedHeight });
    }, BOUNDS_SAVE_DELAY_MS);
  };
  await win.onMoved(reportBounds);
  await win.onResized(reportBounds);

  // 4. Tray icon and menu.
  let autostart = await isEnabled().catch(() => false);
  const toggleVisible = async () => {
    if (await win.isVisible()) {
      await win.hide();
    } else {
      await win.show();
      await win.setFocus();
    }
  };
  const permanentTopItem = await CheckMenuItem.new({
    id: "permanent-top",
    text: "窗口永久置顶",
    checked: permanentTop,
    action: async () => {
      permanentTop = !permanentTop;
      await win.setAlwaysOnTop(permanentTop);
      await permanentTopItem.setChecked(permanentTop);
      listeners.forEach((listener) => listener({ permanentTop }));
    },
  });
  const autostartItem = await CheckMenuItem.new({
    id: "autostart",
    text: "开机自启",
    checked: autostart,
    action: async () => {
      await (autostart ? disable() : enable());
      autostart = await isEnabled();
      await autostartItem.setChecked(autostart);
      listeners.forEach((listener) => listener({ autostart }));
    },
  });
  const menu = await Menu.new({
    items: [
      await MenuItem.new({ id: "toggle", text: "显示 / 隐藏", action: () => void toggleVisible() }),
      permanentTopItem,
      autostartItem,
      await MenuItem.new({
        id: "check-updates",
        text: "检查更新…",
        action: async () => {
          // The answer is shown in the window, so bring it up first.
          await win.show();
          await win.setFocus();
          updateListeners.forEach((listener) => listener());
        },
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        id: "quit",
        text: "退出 Moli Todo",
        action: () => void invoke("quit_app"),
      }),
    ],
  });
  const icon = await defaultWindowIcon();
  await TrayIcon.new({
    id: "main",
    tooltip: "Moli Todo",
    ...(icon ? { icon } : {}),
    menu,
    showMenuOnLeftClick: false,
    action: (event) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up")
        void toggleVisible();
    },
  });

  return {
    async setPermanentTop(on) {
      permanentTop = on;
      await win.setAlwaysOnTop(on);
      await permanentTopItem.setChecked(on);
    },
    async setCollapsed(next, fallbackHeight) {
      const scale = await win.scaleFactor();
      const size = await win.outerSize();
      if (next) {
        expandedHeight = size.height || Math.round(fallbackHeight * scale);
        collapsed = true;
        await win.setMinSize(new LogicalSize(MIN_WIDTH, COLLAPSED_HEIGHT));
        await win.setSize(new PhysicalSize(size.width, Math.round(COLLAPSED_HEIGHT * scale)));
      } else {
        collapsed = false;
        await win.setSize(new PhysicalSize(size.width, expandedHeight));
      }
    },
    isAutostart: () => isEnabled(),
    async setAutostart(on) {
      await (on ? enable() : disable());
      autostart = await isEnabled();
      await autostartItem.setChecked(autostart);
    },
    hide: () => win.hide(),
    quit: () => invoke<void>("quit_app"),
    onTrayChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onCheckUpdates(listener) {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
  };
}
