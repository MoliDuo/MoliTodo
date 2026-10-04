import { StrictMode } from "react";
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

void start();
