import { describe, expect, it, vi } from "vitest";
import {
  AuthNetworkError,
  bearerHeaders,
  DeviceAuth,
  DEVICE_GRANT,
  idTokenExpiry,
  LoginFailedError,
  LoginRequiredError,
  TokenManager,
} from "./device-auth";
import { SyncError } from "./sync";

const ISSUER = "https://auth.example.com";
const CLIENT = "moli-todo-app";

const b64 = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (expSeconds: number | undefined) =>
  `${b64({ alg: "RS256" })}.${b64({ exp: expSeconds })}.sig`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  url: string;
  form: URLSearchParams | null;
}

/** An identity service in a function. `token` answers each token-endpoint call in turn. */
function service(
  token: (call: Call, n: number) => Response | Promise<Response>,
  over: { device?: object } = {}
) {
  const calls: Call[] = [];
  let tokenCalls = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, form: init?.body ? new URLSearchParams(String(init.body)) : null };
    calls.push(call);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return json(200, {
        issuer: ISSUER,
        token_endpoint: `${ISSUER}/api/oidc/token`,
        device_authorization_endpoint: `${ISSUER}/api/oidc/device-authorization`,
      });
    }
    if (url.endsWith("/device-authorization")) {
      return json(200, {
        device_code: "dev-123",
        user_code: "ABCD-1234",
        verification_uri: `${ISSUER}/activate`,
        verification_uri_complete: `${ISSUER}/activate?user_code=ABCD-1234`,
        expires_in: 600,
        interval: 5,
        ...over.device,
      });
    }
    if (url.endsWith("/token")) return token(call, (tokenCalls += 1));
    return json(404, {});
  }) as typeof fetch;
  return { fetchFn, calls, tokenCalls: () => tokenCalls };
}

function setup(token: Parameters<typeof service>[0], over: Parameters<typeof service>[1] = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const svc = service(token, over);
  const auth = new DeviceAuth({
    issuer: ISSUER,
    clientId: CLIENT,
    fetch: svc.fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { ...svc, auth, sleeps, advance: (ms: number) => (clock += ms), now: () => clock };
}

describe("idTokenExpiry", () => {
  it("reads exp in milliseconds and gives null for anything unreadable", () => {
    expect(idTokenExpiry(jwt(2000))).toBe(2_000_000);
    expect(idTokenExpiry(jwt(undefined))).toBeNull();
    expect(idTokenExpiry("not-a-token")).toBeNull();
    expect(idTokenExpiry("a.%%%.c")).toBeNull();
  });
});

describe("DeviceAuth.start", () => {
  it("asks for a code with the client id and the scopes, and reads the answer", async () => {
    const s = setup(() => json(400, {}));
    const login = await s.auth.start();
    expect(login).toMatchObject({
      deviceCode: "dev-123",
      userCode: "ABCD-1234",
      verificationUri: `${ISSUER}/activate`,
      verificationUriComplete: `${ISSUER}/activate?user_code=ABCD-1234`,
      intervalMs: 5000,
      expiresAt: s.now() + 600_000,
    });
    const request = s.calls.find((c) => c.url.endsWith("/device-authorization"));
    expect(request?.form?.get("client_id")).toBe(CLIENT);
    expect(request?.form?.get("scope")).toBe("openid profile email offline_access");
  });

  it("uses defaults when the service leaves out the optional fields", async () => {
    const s = setup(() => json(400, {}), {
      device: { verification_uri_complete: undefined, expires_in: undefined, interval: undefined },
    });
    const login = await s.auth.start();
    expect(login.verificationUriComplete).toBeNull();
    expect(login.intervalMs).toBe(5000);
    expect(login.expiresAt).toBe(s.now() + 600_000);
  });

  it("fails as a network problem when the service answers wrongly or cannot be reached", async () => {
    const bad = setup(() => json(400, {}), { device: { user_code: undefined } });
    await expect(bad.auth.start()).rejects.toBeInstanceOf(AuthNetworkError);
    const down = new DeviceAuth({
      issuer: ISSUER,
      clientId: CLIENT,
      fetch: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
    });
    await expect(down.start()).rejects.toBeInstanceOf(AuthNetworkError);
  });

  it("fails when discovery is broken or lacks the device endpoint, and tries again next time", async () => {
    let healthy = false;
    const auth = new DeviceAuth({
      issuer: ISSUER,
      clientId: CLIENT,
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("openid-configuration")) {
          return healthy
            ? json(200, {
                token_endpoint: "https://x/token",
                device_authorization_endpoint: "https://x/device-authorization",
              })
            : json(200, { token_endpoint: "https://x/token" });
        }
        return json(200, { device_code: "d", user_code: "u", verification_uri: "https://x/a" });
      }) as typeof fetch,
    });
    await expect(auth.start()).rejects.toBeInstanceOf(AuthNetworkError);
    healthy = true;
    await expect(auth.start()).resolves.toMatchObject({ deviceCode: "d" });
    const down = new DeviceAuth({
      issuer: ISSUER,
      clientId: CLIENT,
      fetch: async () => json(500, {}),
    });
    await expect(down.start()).rejects.toBeInstanceOf(AuthNetworkError);
  });
});

describe("DeviceAuth.waitForApproval", () => {
  const ok = { id_token: jwt(5000), refresh_token: "refresh-1", expires_in: 3600 };

  it("polls until approved, sending the device code and client id", async () => {
    const s = setup((_c, n) =>
      n < 3 ? json(400, { error: "authorization_pending" }) : json(200, ok)
    );
    const login = await s.auth.start();
    const tokens = await s.auth.waitForApproval(login);
    expect(tokens).toEqual({
      idToken: ok.id_token,
      refreshToken: "refresh-1",
      expiresAt: 5_000_000,
    });
    expect(s.sleeps).toEqual([5000, 5000, 5000]);
    const poll = s.calls.filter((c) => c.url.endsWith("/token"))[0];
    expect(poll?.form?.get("grant_type")).toBe(DEVICE_GRANT);
    expect(poll?.form?.get("device_code")).toBe("dev-123");
    expect(poll?.form?.get("client_id")).toBe(CLIENT);
  });

  it("waits longer after slow_down", async () => {
    const s = setup((_c, n) => (n === 1 ? json(400, { error: "slow_down" }) : json(200, ok)));
    await s.auth.waitForApproval(await s.auth.start());
    expect(s.sleeps).toEqual([5000, 10_000]);
  });

  it("stops when the person says no, the code expires, or it runs out of time", async () => {
    const denied = setup(() => json(400, { error: "access_denied" }));
    await expect(denied.auth.waitForApproval(await denied.auth.start())).rejects.toMatchObject({
      reason: "denied",
    });
    const expired = setup(() => json(400, { error: "expired_token" }));
    await expect(expired.auth.waitForApproval(await expired.auth.start())).rejects.toMatchObject({
      reason: "expired",
    });
    const never = setup(() => json(400, { error: "authorization_pending" }), {
      device: { expires_in: 12 },
    });
    await expect(never.auth.waitForApproval(await never.auth.start())).rejects.toMatchObject({
      reason: "expired",
    });
    const odd = setup(() => json(400, { error: "invalid_client" }));
    await expect(odd.auth.waitForApproval(await odd.auth.start())).rejects.toBeInstanceOf(
      LoginFailedError
    );
  });

  it("keeps waiting through lost connections and server errors", async () => {
    const s = setup((_c, n) => {
      if (n === 1) throw new TypeError("offline");
      if (n === 2) return json(503, {});
      return json(200, ok);
    });
    const tokens = await s.auth.waitForApproval(await s.auth.start());
    expect(tokens.idToken).toBe(ok.id_token);
    expect(s.tokenCalls()).toBe(3);
  });

  it("can be cancelled", async () => {
    const s = setup(() => json(400, { error: "authorization_pending" }));
    const controller = new AbortController();
    const login = await s.auth.start();
    const waiting = s.auth.waitForApproval(login, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ reason: "cancelled" });
  });

  it("uses expires_in when the token has no readable expiry, and now when it has neither", async () => {
    const a = setup(() => json(200, { id_token: "opaque", expires_in: 100 }));
    expect((await a.auth.waitForApproval(await a.auth.start())).expiresAt).toBe(a.now() + 100_000);
    const b = setup(() => json(200, { id_token: "opaque" }));
    const tokens = await b.auth.waitForApproval(await b.auth.start());
    expect(tokens.expiresAt).toBe(b.now());
    expect(tokens.refreshToken).toBeNull();
  });

  it("treats an approval without an ID token as a service problem", async () => {
    const s = setup(() => json(200, { access_token: "x" }));
    await expect(s.auth.waitForApproval(await s.auth.start())).rejects.toBeInstanceOf(
      AuthNetworkError
    );
  });
});

describe("DeviceAuth.refresh", () => {
  it("sends the refresh token and keeps the old one when the answer has no new one", async () => {
    const s = setup(() => json(200, { id_token: jwt(9000) }));
    const tokens = await s.auth.refresh("old-refresh");
    expect(tokens).toMatchObject({
      idToken: jwt(9000),
      refreshToken: "old-refresh",
      expiresAt: 9_000_000,
    });
    const call = s.calls.find((c) => c.url.endsWith("/token"));
    expect(call?.form?.get("grant_type")).toBe("refresh_token");
    expect(call?.form?.get("refresh_token")).toBe("old-refresh");
    expect(call?.form?.get("client_id")).toBe(CLIENT);
  });

  it("takes a rotated refresh token", async () => {
    const s = setup(() => json(200, { id_token: jwt(9000), refresh_token: "new" }));
    expect((await s.auth.refresh("old")).refreshToken).toBe("new");
  });

  it("says login is required when the service refuses the token, and network trouble otherwise", async () => {
    const refused = setup(() => json(400, { error: "invalid_grant" }));
    await expect(refused.auth.refresh("x")).rejects.toBeInstanceOf(LoginRequiredError);
    const unauthorized = setup(() => json(401, {}));
    await expect(unauthorized.auth.refresh("x")).rejects.toBeInstanceOf(LoginRequiredError);
    const failing = setup(() => json(503, {}));
    await expect(failing.auth.refresh("x")).rejects.toBeInstanceOf(AuthNetworkError);
    const down = setup(() => {
      throw new TypeError("offline");
    });
    await expect(down.auth.refresh("x")).rejects.toBeInstanceOf(AuthNetworkError);
  });
});

describe("TokenManager", () => {
  function manager(token: Parameters<typeof service>[0], refreshToken: string | null = "r1") {
    const s = setup(token);
    const saved: (string | null)[] = [];
    const tokens = new TokenManager({
      auth: s.auth,
      refreshToken,
      saveRefreshToken: (value) => void saved.push(value),
      now: s.now,
    });
    return { ...s, tokens, saved };
  }
  const fresh = (s: { now: () => number }, lifetimeMs: number, extra: object = {}) =>
    json(200, { id_token: jwt((s.now() + lifetimeMs) / 1000), ...extra });

  it("refreshes when it has no ID token, reuses it until a minute before it runs out, then refreshes again", async () => {
    const s: ReturnType<typeof manager> = manager(() => fresh(s, 3_600_000));
    const first = await s.tokens.idTokenForRequest();
    expect(await s.tokens.idTokenForRequest()).toBe(first);
    expect(s.tokenCalls()).toBe(1);
    s.advance(3_600_000 - 30_000);
    await s.tokens.idTokenForRequest();
    expect(s.tokenCalls()).toBe(2);
  });

  it("makes one refresh for requests made at the same time", async () => {
    const s: ReturnType<typeof manager> = manager(() => fresh(s, 3_600_000));
    await Promise.all([
      s.tokens.idTokenForRequest(),
      s.tokens.idTokenForRequest(),
      s.tokens.idTokenForRequest(),
    ]);
    expect(s.tokenCalls()).toBe(1);
  });

  it("saves a rotated refresh token, and only when it changed", async () => {
    const s: ReturnType<typeof manager> = manager((_c, n) =>
      fresh(s, 1000, n === 1 ? { refresh_token: "r2" } : {})
    );
    await s.tokens.idTokenForRequest();
    s.advance(5000);
    await s.tokens.idTokenForRequest();
    expect(s.saved).toEqual(["r2"]);
  });

  it("is signed out without a refresh token, and signs out when the refresh token is refused", async () => {
    const out = manager(() => json(400, {}), null);
    expect(out.tokens.signedIn).toBe(false);
    await expect(out.tokens.idTokenForRequest()).rejects.toBeInstanceOf(LoginRequiredError);
    expect(out.tokenCalls()).toBe(0);

    const refused = manager(() => json(400, { error: "invalid_grant" }));
    await expect(refused.tokens.idTokenForRequest()).rejects.toBeInstanceOf(LoginRequiredError);
    expect(refused.tokens.signedIn).toBe(false);
    expect(refused.saved).toEqual([null]);
  });

  it("stays signed in when the service is just unreachable", async () => {
    const s = manager(() => json(503, {}));
    await expect(s.tokens.idTokenForRequest()).rejects.toBeInstanceOf(AuthNetworkError);
    expect(s.tokens.signedIn).toBe(true);
    expect(s.saved).toEqual([]);
  });

  it("takes the tokens of a finished sign-in and forgets them on sign-out", async () => {
    const s = manager(() => json(503, {}), null);
    await s.tokens.accept({ idToken: "id", refreshToken: "r9", expiresAt: s.now() + 3_600_000 });
    expect(s.tokens.signedIn).toBe(true);
    expect(await s.tokens.idTokenForRequest()).toBe("id");
    expect(s.saved).toEqual(["r9"]);
    await s.tokens.signOut();
    expect(s.tokens.signedIn).toBe(false);
    expect(s.saved).toEqual(["r9", null]);
  });
});

describe("bearerHeaders", () => {
  it("adds the token, and maps failures to what the sync engine understands", async () => {
    const ok = { idTokenForRequest: async () => "tok" } as unknown as TokenManager;
    expect(await bearerHeaders(ok)()).toEqual({ authorization: "Bearer tok" });
    const required = {
      idTokenForRequest: vi.fn().mockRejectedValue(new LoginRequiredError()),
    } as unknown as TokenManager;
    await expect(bearerHeaders(required)()).rejects.toMatchObject({ kind: "auth" });
    const network = {
      idTokenForRequest: vi.fn().mockRejectedValue(new AuthNetworkError()),
    } as unknown as TokenManager;
    const error = await bearerHeaders(network)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).kind).toBe("offline");
  });
});
