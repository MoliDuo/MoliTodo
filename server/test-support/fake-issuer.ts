import { createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from "jose";

export const ISSUER = "https://auth.example.com";
export const WEB_CLIENT = "moli-todo";
export const WEB_SECRET = "test-client-secret";
export const REDIRECT_URI = "https://todo.example.com/auth/callback";

interface Pending {
  nonce: string;
  challenge: string;
  username: string;
}

/** A stand-in for Authelia: discovery, JWKS and the token endpoint, reached through an injected fetch. */
export async function createFakeIssuer(clock: { now: number }) {
  const publish = async (pair: Awaited<ReturnType<typeof generateKeyPair>>, kid: string) => ({
    ...(await exportJWK(pair.publicKey)),
    kid,
    alg: "RS256",
    use: "sig",
  });
  let main = { pair: await generateKeyPair("RS256", { extractable: true }), kid: "k1" };
  const rogue = await generateKeyPair("RS256", { extractable: true });
  const rs384 = await generateKeyPair("RS384", { extractable: true });

  const pending = new Map<string, Pending>();
  let counter = 0;
  const requests: string[] = [];
  let lastIdToken = "";
  const state = {
    /** Replaces claims of the next ID token returned by the token endpoint. */
    override: {} as JWTPayload,
    /** Sign the next token with a key the server does not know. */
    signWithRogueKey: false,
    /** Sign the next token with this algorithm instead of RS256. */
    signWithAlg: undefined as "RS384" | undefined,
    jwks: [await publish(main.pair, "k1")] as object[],
    /** The service starts signing with a new key and publishes it next to the old one. */
    async rotate() {
      main = { pair: await generateKeyPair("RS256", { extractable: true }), kid: "k2" };
      state.jwks = [...state.jwks, await publish(main.pair, "k2")];
    },
  };

  const claimsFor = (username: string, audience: string, extra: JWTPayload = {}): JWTPayload => {
    const iat = Math.floor(clock.now / 1000);
    return {
      iss: ISSUER,
      aud: audience,
      sub: `sub-${username}`,
      iat,
      exp: iat + 3600,
      preferred_username: username,
      name: `${username} name`,
      email: `${username}@example.com`,
      ...extra,
    };
  };

  async function sign(
    claims: JWTPayload,
    options: { rogue?: boolean; alg?: "RS256" | "RS384" } = {}
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: options.alg ?? "RS256", kid: options.rogue ? "rogue" : main.kid })
      .sign(
        options.alg === "RS384"
          ? rs384.privateKey
          : options.rogue
            ? rogue.privateKey
            : main.pair.privateKey
      );
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchFake: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    requests.push(url.pathname);
    if (url.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/api/oidc/authorization`,
        token_endpoint: `${ISSUER}/api/oidc/token`,
        jwks_uri: `${ISSUER}/jwks.json`,
      });
    }
    if (url.pathname === "/jwks.json") return json({ keys: state.jwks });
    if (url.pathname === "/api/oidc/token") {
      const form = new URLSearchParams(String(init?.body));
      const entry = pending.get(form.get("code") ?? "");
      pending.delete(form.get("code") ?? "");
      const challenge = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      const valid =
        entry &&
        form.get("client_id") === WEB_CLIENT &&
        form.get("client_secret") === WEB_SECRET &&
        form.get("redirect_uri") === REDIRECT_URI &&
        form.get("grant_type") === "authorization_code" &&
        entry.challenge === challenge;
      if (!valid) return json({ error: "invalid_grant" }, 400);
      const claims = {
        ...claimsFor(entry.username, WEB_CLIENT, { nonce: entry.nonce }),
        ...state.override,
      };
      state.override = {};
      const rogueKey = state.signWithRogueKey;
      const alg = state.signWithAlg;
      state.signWithRogueKey = false;
      state.signWithAlg = undefined;
      lastIdToken = await sign(claims, { rogue: rogueKey, ...(alg ? { alg } : {}) });
      return json({ id_token: lastIdToken, token_type: "Bearer" });
    }
    return new Response("not found", { status: 404 });
  };

  return {
    fetch: fetchFake,
    state,
    requests,
    /** The ID token the token endpoint handed out last (a real, valid one). */
    lastIdToken: async () => lastIdToken,
    /** The user signs in at the identity service: returns what Authelia would send back to the callback. */
    approve(authorizeUrl: string, username = "alice") {
      const url = new URL(authorizeUrl);
      const code = `code-${(counter += 1)}`;
      pending.set(code, {
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        username,
      });
      return { code, state: url.searchParams.get("state") ?? "" };
    },
  };
}
