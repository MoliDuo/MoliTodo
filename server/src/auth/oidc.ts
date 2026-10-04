import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export type FetchLike = typeof fetch;

export interface OidcOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** `aud` expected on bearer tokens from the desktop client. */
  nativeClientId: string;
  redirectUri: string;
  fetch?: FetchLike;
  now?: () => number;
}

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
type Discovery = z.infer<typeof discoverySchema>;

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

export interface Identity {
  /** `preferred_username`, lower-cased (standard 008, 8.4.1). */
  username: string;
  name: string | null;
  email: string | null;
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcError";
  }
}

/** An ID token older than this at the callback is treated as a replay (8.5.3). */
const MAX_ID_TOKEN_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 60;
const JWKS_REFRESH_MIN_INTERVAL_MS = 60_000;

const base64url = (buffer: Buffer) => buffer.toString("base64url");

export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));
export const pkceChallenge = (verifier: string) =>
  base64url(createHash("sha256").update(verifier).digest());

/** Talks to the identity service (Authelia): discovery, code exchange, ID token verification. */
export class OidcClient {
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private discovery: Promise<Discovery> | null = null;
  private jwks: { keySet: ReturnType<typeof createLocalJWKSet>; fetchedAt: number } | null = null;

  constructor(private readonly options: OidcOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private async getJson(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchFn(url, init);
    if (!response.ok) throw new OidcError(`${new URL(url).pathname} answered ${response.status}`);
    return response.json();
  }

  /** Endpoints always come from the discovery document, never from fixed paths (8.2). */
  private getDiscovery(): Promise<Discovery> {
    this.discovery ??= this.getJson(`${this.options.issuer}/.well-known/openid-configuration`).then(
      (body) => {
        const parsed = discoverySchema.parse(body);
        if (parsed.issuer !== this.options.issuer)
          throw new OidcError("issuer mismatch in discovery");
        return parsed;
      }
    );
    this.discovery.catch(() => {
      this.discovery = null; // retry next time
    });
    return this.discovery;
  }

  async authorizeUrl(input: {
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<string> {
    const { authorization_endpoint } = await this.getDiscovery();
    const url = new URL(authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: "openid profile email groups",
      state: input.state,
      nonce: input.nonce,
      code_challenge: pkceChallenge(input.codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  /** Exchanges the code; the client secret goes in the form body (`client_secret_post`, 8.5.1). */
  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const { token_endpoint } = await this.getDiscovery();
    const body = await this.getJson(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.options.redirectUri,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code_verifier: codeVerifier,
      }),
    });
    return tokenResponseSchema.parse(body).id_token;
  }

  private async loadJwks(): Promise<ReturnType<typeof createLocalJWKSet>> {
    const { jwks_uri } = await this.getDiscovery();
    const body = (await this.getJson(jwks_uri)) as JSONWebKeySet;
    const keySet = createLocalJWKSet(body);
    this.jwks = { keySet, fetchedAt: this.now() };
    return keySet;
  }

  /** Cached key set; refreshed once when a token names a key we do not have (8.5.3). */
  private async resolveKey(
    header: Parameters<ReturnType<typeof createLocalJWKSet>>[0],
    token: Parameters<ReturnType<typeof createLocalJWKSet>>[1]
  ) {
    const keySet = this.jwks?.keySet ?? (await this.loadJwks());
    try {
      return await keySet(header, token);
    } catch (error) {
      const unknownKey = error instanceof errors.JWKSNoMatchingKey;
      const mayRefresh =
        this.jwks && this.now() - this.jwks.fetchedAt >= JWKS_REFRESH_MIN_INTERVAL_MS;
      if (!unknownKey || !mayRefresh) throw error;
      return (await this.loadJwks())(header, token);
    }
  }

  private async verify(token: string, audience: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, (header, jwt) => this.resolveKey(header, jwt), {
        issuer: this.options.issuer,
        audience,
        algorithms: ["RS256"],
        currentDate: new Date(this.now()),
        clockTolerance: CLOCK_SKEW_SECONDS,
        requiredClaims: ["exp", "iat"],
      });
      return payload;
    } catch (error) {
      throw new OidcError(error instanceof Error ? error.message : "token rejected");
    }
  }

  private identityOf(payload: JWTPayload): Identity {
    const username = payload["preferred_username"];
    if (typeof username !== "string" || username.trim() === "") {
      throw new OidcError("token has no preferred_username");
    }
    const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
    return {
      username: username.trim().toLowerCase(),
      name: text(payload["name"]),
      email: text(payload["email"]),
    };
  }

  /** The ID token from the web callback: signature, iss, aud, exp, iat, nonce, username (8.5.3). */
  async verifyIdToken(token: string, expectedNonce: string): Promise<Identity> {
    const payload = await this.verify(token, this.options.clientId);
    const nowSeconds = this.now() / 1000;
    const iat = payload.iat as number;
    if (nowSeconds - iat > MAX_ID_TOKEN_AGE_SECONDS) throw new OidcError("ID token is too old");
    if (payload["nonce"] !== expectedNonce) throw new OidcError("nonce mismatch");
    return this.identityOf(payload);
  }

  /**
   * An ID token a desktop client sends as `Authorization: Bearer` (8.7.3): `aud` is the desktop client.
   * It is not rejected for being old: it lives until `exp`, and the desktop refreshes it (8.7.5).
   */
  async verifyBearerToken(token: string): Promise<Identity> {
    const payload = await this.verify(token, this.options.nativeClientId);
    if ((payload.iat as number) - this.now() / 1000 > CLOCK_SKEW_SECONDS) {
      throw new OidcError("token issued in the future");
    }
    return this.identityOf(payload);
  }
}
