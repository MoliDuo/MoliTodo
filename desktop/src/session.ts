import { bearerHeaders, DeviceAuth, TokenManager } from "@shared/device-auth";
import { createHttpTransport } from "@shared/http-transport";
import { meResponseSchema } from "@shared/api";
import type { SyncState } from "@shared/sync";
import { createStore, type TodoStore } from "@web/store";
import { CLIENT_NAME, OIDC_CLIENT_ID, OIDC_ISSUER, SERVER_URL } from "./config";
import type { Platform } from "./platform";
import { createSaver, loadSettings, loadState, type Settings } from "./persistence";

const SAVE_DELAY_MS = 400;

export interface Session {
  store: TodoStore;
  auth: DeviceAuth;
  tokens: TokenManager;
  settings(): Settings;
  /** Changes some settings and saves them. */
  updateSettings(patch: Partial<Settings>): void;
  /** Called once a device sign-in finished: learns who it is, starts from an empty copy if it is someone else. */
  completeSignIn(): Promise<void>;
  /** Forgets the sign-in; `clearLocal` also deletes the tasks kept on this machine. */
  signOut(options: { clearLocal: boolean }): Promise<void>;
  /** Writes everything to disk now (before hiding or quitting). */
  flush(): Promise<void>;
}

export interface SessionOptions {
  platform: Platform;
  /** Report a file that could not be saved. */
  onError?: (error: unknown) => void;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Wires the local files, the sign-in and the sync engine together. */
export async function createSession(options: SessionOptions): Promise<Session> {
  const { platform } = options;
  const onError = options.onError ?? (() => undefined);
  const [initialSettings, initialState] = await Promise.all([
    loadSettings(platform),
    loadState(platform),
  ]);

  let settings = initialSettings;
  let owner = initialState.owner;

  const settingsSaver = createSaver(
    (text) => platform.writeFile("settings.json", text),
    SAVE_DELAY_MS,
    onError
  );
  const stateSaver = createSaver(
    (text) => platform.writeFile("state.json", text),
    SAVE_DELAY_MS,
    onError
  );
  const saveSettings = () => settingsSaver.schedule(() => JSON.stringify(settings));
  const stateText = (sync: SyncState) => JSON.stringify({ owner, sync });

  const auth = new DeviceAuth({
    issuer: OIDC_ISSUER,
    clientId: OIDC_CLIENT_ID,
    fetch: platform.fetch,
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  const tokens = new TokenManager({
    auth,
    refreshToken: settings.refreshToken,
    saveRefreshToken: async (token) => {
      settings = { ...settings, refreshToken: token };
      saveSettings();
      await settingsSaver.flush();
    },
    ...(options.now ? { now: options.now } : {}),
  });

  const store = createStore({
    transport: createHttpTransport({
      baseUrl: SERVER_URL,
      client: CLIENT_NAME,
      headers: bearerHeaders(tokens),
      fetch: platform.fetch,
    }),
    state: initialState.sync,
    onChange: (sync) => stateSaver.schedule(() => stateText(sync)),
  });

  return {
    store,
    auth,
    tokens,
    settings: () => settings,
    updateSettings(patch) {
      settings = { ...settings, ...patch };
      saveSettings();
    },
    async completeSignIn() {
      const headers = await bearerHeaders(tokens)();
      const response = await platform.fetch(`${SERVER_URL}/api/v1/me`, { headers });
      if (!response.ok) throw new Error(`could not read the account: ${response.status}`);
      const me = meResponseSchema.parse(await response.json());
      if (owner !== null && owner !== me.username) store.engine.reset();
      owner = me.username;
      settings = { ...settings, account: { username: me.username, name: me.name } };
      saveSettings();
      stateSaver.schedule(() => stateText(store.engine.getState()));
    },
    async signOut({ clearLocal }) {
      await tokens.signOut();
      settings = { ...settings, account: null };
      saveSettings();
      if (clearLocal) {
        owner = null;
        store.engine.reset();
      }
    },
    async flush() {
      await Promise.all([settingsSaver.flush(), stateSaver.flush()]);
    },
  };
}
