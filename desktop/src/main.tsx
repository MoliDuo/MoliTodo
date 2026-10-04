import { StrictMode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import { DesktopApp } from "./DesktopApp";
import { createSession } from "./session";
import { createTauriPlatform, createTauriUpdater, setUpWindow } from "./tauri";
import { createUpdateController } from "./updates";
import "./styles.css";

async function start() {
  const platform = createTauriPlatform();
  const session = await createSession({
    platform,
    // eslint-disable-next-line no-console -- the only place a failed save can be reported from
    onError: (error) => console.error("could not save", error),
  });
  const windowControl = await setUpWindow({
    settings: session.settings(),
    onBounds: (bounds) => session.updateSettings({ bounds }),
  });
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <DesktopApp
        session={session}
        platform={platform}
        windowControl={windowControl}
        version={__APP_VERSION__}
        updates={createUpdateController({ updater: createTauriUpdater() })}
      />
    </StrictMode>
  );
}

/** A page that fails to start must say why, in the window and in a file, instead of staying blank. */
function reportStartupFailure(error: unknown) {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : String(error);
  const root = document.getElementById("root");
  if (root && !root.hasChildNodes()) {
    const pre = document.createElement("pre");
    pre.style.cssText =
      "margin:0;padding:12px;font:12px/1.4 monospace;white-space:pre-wrap;user-select:text";
    pre.textContent = `Moli Todo 没能启动：\n${text}`;
    root.append(pre);
  }
  void invoke("report_startup_failure", { text }).catch(() => undefined);
}

window.addEventListener("unhandledrejection", (event) => reportStartupFailure(event.reason));
window.addEventListener("error", (event) => reportStartupFailure(event.error ?? event.message));
start().catch(reportStartupFailure);
