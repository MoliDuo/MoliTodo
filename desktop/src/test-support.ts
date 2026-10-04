import { createFakeApi } from "@web/test-support/fake-api";
import type { DataFile, Platform, WindowControl } from "./platform";
import { OIDC_CLIENT_ID, OIDC_ISSUER, SERVER_URL } from "./config";

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const idToken = (expSeconds: number) => {
  const part = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "RS256" })}.${part({ exp: expSeconds })}.sig`;
};

/** The sign-in service: device flow and refresh, with knobs for the cases the tests need. */
export function createFakeIdentity() {
  const identity = {
    /** Device-flow polls that answer "pending" before the person approves. */
    pendingPolls: 1,
    /** Answer to the polling once it is over: "approve" or an OAuth error code. */
    outcome: "approve" as string,
    refreshFails: null as number | null,
    /** The service is unreachable. */
    down: false,
    polls: 0,
    refreshes: 0,
    tokenLifetimeS: 3600,
    nowS: () => Math.floor(Date.now() / 1000),
    handle: async (url: URL, form: URLSearchParams): Promise<Response> => {
      if (identity.down) throw new TypeError("failed to fetch");
      if (url.pathname === "/.well-known/openid-configuration") {
        return jsonResponse(200, {
          token_endpoint: `${OIDC_ISSUER}/api/oidc/token`,
          device_authorization_endpoint: `${OIDC_ISSUER}/api/oidc/device-authorization`,
        });
      }
      if (url.pathname.endsWith("/device-authorization")) {
        return jsonResponse(200, {
          device_code: "dev-1",
          user_code: "WXYZ-9876",
          verification_uri: `${OIDC_ISSUER}/activate`,
          verification_uri_complete: `${OIDC_ISSUER}/activate?user_code=WXYZ-9876`,
          expires_in: 600,
          interval: 5,
        });
      }
      if (url.pathname.endsWith("/token")) {
        if (form.get("client_id") !== OIDC_CLIENT_ID)
          return jsonResponse(400, { error: "invalid_client" });
        if (form.get("grant_type") === "refresh_token") {
          identity.refreshes += 1;
          if (identity.refreshFails)
            return jsonResponse(identity.refreshFails, { error: "invalid_grant" });
          return jsonResponse(200, {
            id_token: idToken(identity.nowS() + identity.tokenLifetimeS),
            refresh_token: `refresh-${identity.refreshes + 1}`,
          });
        }
        identity.polls += 1;
        if (identity.polls <= identity.pendingPolls)
          return jsonResponse(400, { error: "authorization_pending" });
        if (identity.outcome !== "approve") return jsonResponse(400, { error: identity.outcome });
        return jsonResponse(200, {
          id_token: idToken(identity.nowS() + identity.tokenLifetimeS),
          refresh_token: "refresh-1",
        });
      }
      return jsonResponse(404, {});
    },
  };
  return identity;
}

/** The whole outside world: our server and the sign-in service, behind one `fetch`. */
export function createWorld() {
  const server = createFakeApi();
  const identity = createFakeIdentity();
  const world = {
    server,
    identity,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === new URL(OIDC_ISSUER).origin) {
        return identity.handle(url, new URLSearchParams(init?.body ? String(init.body) : ""));
      }
      if (url.origin === new URL(SERVER_URL).origin)
        return server.fetch(`${url.pathname}${url.search}`, init);
      throw new TypeError("unknown host");
    }) as typeof fetch,
  };
  return world;
}

/** Files in memory, and a record of what the app opened. */
export function createMemoryPlatform(
  world = createWorld(),
  files: Partial<Record<DataFile, string>> = {}
) {
  const store = { ...files };
  const platform = {
    files: store,
    opened: [] as string[],
    quarantined: [] as DataFile[],
    legacy: null as string | null,
    writes: 0,
    failWrites: false,
    readFile: async (name: DataFile) => store[name] ?? null,
    writeFile: async (name: DataFile, text: string) => {
      if (platform.failWrites) throw new Error("disk full");
      platform.writes += 1;
      store[name] = text;
    },
    quarantineFile: async (name: DataFile) => {
      platform.quarantined.push(name);
      delete store[name];
    },
    readLegacyStore: async () => platform.legacy,
    fetch: world.fetch,
    openUrl: async (url: string) => {
      platform.opened.push(url);
    },
  };
  return platform satisfies Platform & Record<string, unknown>;
}

export function createFakeWindow() {
  const listeners = new Set<(change: { permanentTop?: boolean; autostart?: boolean }) => void>();
  const calls: string[] = [];
  const state = { autostart: false };
  const control = {
    state,
    calls,
    /** The tray menu changes something. */
    tray: (change: { permanentTop?: boolean; autostart?: boolean }) =>
      listeners.forEach((l) => l(change)),
    setPermanentTop: async (on: boolean) => void calls.push(`top:${on}`),
    setCollapsed: async (collapsed: boolean, height: number) =>
      void calls.push(`collapsed:${collapsed}:${height}`),
    isAutostart: async (): Promise<boolean> => state.autostart,
    setAutostart: async (on: boolean) => {
      calls.push(`autostart:${on}`);
      state.autostart = on;
    },
    hide: async () => void calls.push("hide"),
    quit: async () => void calls.push("quit"),
    onTrayChange: (listener: (change: { permanentTop?: boolean; autostart?: boolean }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies WindowControl & Record<string, unknown>;
  return control;
}
