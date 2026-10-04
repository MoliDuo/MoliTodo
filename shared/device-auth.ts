// Sign-in for the desktop app (standard 008, 8.7): the device-code flow against the identity service, then an
// ID token on every request to our server. The refresh token is kept by the caller (a local settings file);
// the ID token only in memory.

import { SyncError } from "./sync";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_INTERVAL_S = 5;
const SLOW_DOWN_STEP_S = 5;

/** The sign-in is no longer valid and the person has to sign in again. Local data stays. */
export class LoginRequiredError extends Error {
  constructor() {
    super("login required");
  }
}

/** The identity service could not be reached or failed; try again later. */
export class AuthNetworkError extends Error {
  constructor(message = "network") {
    super(message);
  }
}

/** The person said no, the code ran out, or the flow was cancelled. */
export class LoginFailedError extends Error {
  readonly reason: "denied" | "expired" | "cancelled";
  constructor(reason: "denied" | "expired" | "cancelled") {
    super(reason);
    this.reason = reason;
  }
}

export interface DeviceLogin {
  deviceCode: string;
  /** The short code the person types or confirms on the sign-in page. */
  userCode: string;
  verificationUri: string;
  /** The same page with the code filled in, when the service offers one. */
  verificationUriComplete: string | null;
  expiresAt: number;
  intervalMs: number;
}

export interface Tokens {
  idToken: string;
  /** Absent when the service keeps the old refresh token. */
  refreshToken: string | null;
  /** When the ID token stops being valid (ms since the epoch). */
  expiresAt: number;
}

export interface DeviceAuthOptions {
  issuer: string;
  /** The desktop client's id; it is the `aud` of the ID token. */
  clientId: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** The expiry (ms) in an ID token's payload; null when it cannot be read. The server does the real checking. */
export function idTokenExpiry(idToken: string): number | null {
  try {
    const payload = idToken.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

interface Endpoints {
  device: string;
  token: string;
}

export class DeviceAuth {
  private endpoints: Promise<Endpoints> | null = null;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: DeviceAuthOptions) {
    this.doFetch = options.fetch ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async post(url: string, form: Record<string, string>): Promise<Response> {
    try {
      return await this.doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new AuthNetworkError();
    }
  }

  private discover(): Promise<Endpoints> {
    this.endpoints ??= (async () => {
      let response: Response;
      try {
        response = await this.doFetch(`${this.options.issuer}/.well-known/openid-configuration`);
      } catch {
        throw new AuthNetworkError();
      }
      if (!response.ok) throw new AuthNetworkError(`discovery ${response.status}`);
      const doc = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const device = doc?.device_authorization_endpoint;
      const token = doc?.token_endpoint;
      if (typeof device !== "string" || typeof token !== "string") {
        throw new AuthNetworkError("the service does not offer device sign-in");
      }
      return { device, token };
    })().catch((error: unknown) => {
      this.endpoints = null; // try again next time
      throw error;
    });
    return this.endpoints;
  }

  /** Asks for a code to show the person. */
  async start(): Promise<DeviceLogin> {
    const { device } = await this.discover();
    const response = await this.post(device, {
      client_id: this.options.clientId,
      scope: "openid profile email offline_access",
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !response.ok ||
      typeof body?.device_code !== "string" ||
      typeof body.user_code !== "string" ||
      typeof body.verification_uri !== "string"
    ) {
      throw new AuthNetworkError(`device authorization ${response.status}`);
    }
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 600;
    const interval =
      typeof body.interval === "number" && body.interval > 0 ? body.interval : DEFAULT_INTERVAL_S;
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      verificationUriComplete:
        typeof body.verification_uri_complete === "string" ? body.verification_uri_complete : null,
      expiresAt: this.now() + expiresIn * 1000,
      intervalMs: interval * 1000,
    };
  }

  /** Waits until the person approves in the browser. Throws `LoginFailedError` on no, expiry or cancel. */
  async waitForApproval(login: DeviceLogin, signal?: AbortSignal): Promise<Tokens> {
    const { token } = await this.discover();
    let intervalMs = login.intervalMs;
    while (this.now() < login.expiresAt) {
      await this.sleep(intervalMs, signal);
      if (signal?.aborted) throw new LoginFailedError("cancelled");
      let response: Response;
      try {
        response = await this.post(token, {
          grant_type: DEVICE_GRANT,
          device_code: login.deviceCode,
          client_id: this.options.clientId,
        });
      } catch {
        continue; // a lost connection while waiting is not a refusal
      }
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok) return this.tokensFrom(body, null);
      switch (body?.error) {
        case "authorization_pending":
          break;
        case "slow_down":
          intervalMs += SLOW_DOWN_STEP_S * 1000;
          break;
        case "access_denied":
          throw new LoginFailedError("denied");
        case "expired_token":
          throw new LoginFailedError("expired");
        default:
          if (response.status >= 500) break; // the service is having trouble: keep waiting
          throw new LoginFailedError("denied");
      }
    }
    throw new LoginFailedError("expired");
  }

  /** Trades the refresh token for a new ID token. */
  async refresh(refreshToken: string): Promise<Tokens> {
    const { token } = await this.discover();
    const response = await this.post(token, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.options.clientId,
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok) return this.tokensFrom(body, refreshToken);
    // The service says the refresh token is not good any more (revoked, expired, wrong client).
    if (response.status >= 400 && response.status < 500) throw new LoginRequiredError();
    throw new AuthNetworkError(`token endpoint ${response.status}`);
  }

  private tokensFrom(body: Record<string, unknown> | null, keep: string | null): Tokens {
    const idToken = body?.id_token;
    if (typeof idToken !== "string") throw new AuthNetworkError("no ID token in the answer");
    const fromToken = idTokenExpiry(idToken);
    const fromLifetime =
      typeof body?.expires_in === "number" ? this.now() + body.expires_in * 1000 : null;
    return {
      idToken,
      refreshToken: typeof body?.refresh_token === "string" ? body.refresh_token : keep,
      expiresAt: fromToken ?? fromLifetime ?? this.now(),
    };
  }
}

export interface TokenManagerOptions {
  auth: DeviceAuth;
  /** The refresh token on disk, or null when signed out. */
  refreshToken: string | null;
  /** Called whenever the refresh token to keep changes (null on sign-out). */
  saveRefreshToken: (token: string | null) => Promise<void> | void;
  now?: () => number;
}

/** Hands out a valid ID token, refreshing it shortly before it runs out. */
export class TokenManager {
  private refreshToken: string | null;
  private idToken: { value: string; expiresAt: number } | null = null;
  private inFlight: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: TokenManagerOptions) {
    this.refreshToken = options.refreshToken;
    this.now = options.now ?? Date.now;
  }

  get signedIn(): boolean {
    return this.refreshToken !== null;
  }

  /** The ID token to send. Throws `LoginRequiredError` when signed out or the refresh token was refused. */
  idTokenForRequest(): Promise<string> {
    if (this.idToken && this.idToken.expiresAt - EXPIRY_MARGIN_MS > this.now()) {
      return Promise.resolve(this.idToken.value);
    }
    if (!this.refreshToken) return Promise.reject(new LoginRequiredError());
    this.inFlight ??= this.renew(this.refreshToken).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async renew(refreshToken: string): Promise<string> {
    try {
      const tokens = await this.options.auth.refresh(refreshToken);
      await this.accept(tokens);
      return tokens.idToken;
    } catch (error) {
      if (error instanceof LoginRequiredError) await this.signOut();
      throw error;
    }
  }

  /** Takes the tokens of a finished sign-in (or a refresh). */
  async accept(tokens: Tokens): Promise<void> {
    this.idToken = { value: tokens.idToken, expiresAt: tokens.expiresAt };
    if (tokens.refreshToken && tokens.refreshToken !== this.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      await this.options.saveRefreshToken(tokens.refreshToken);
    }
  }

  async signOut(): Promise<void> {
    this.idToken = null;
    this.refreshToken = null;
    await this.options.saveRefreshToken(null);
  }
}

/** The headers the sync transport adds: the ID token, with the failure kinds the engine understands. */
export function bearerHeaders(tokens: TokenManager): () => Promise<Record<string, string>> {
  return async () => {
    try {
      return { authorization: `Bearer ${await tokens.idTokenForRequest()}` };
    } catch (error) {
      if (error instanceof LoginRequiredError) throw new SyncError("auth");
      throw new SyncError("offline", "could not refresh the sign-in");
    }
  };
}
