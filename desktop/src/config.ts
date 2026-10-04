/** Where the app talks to. Set at build time; the defaults are the production addresses. */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "https://todo.xiangyu.pro";
export const OIDC_ISSUER = import.meta.env.VITE_OIDC_ISSUER ?? "https://auth.xiangyu.pro";
/** The desktop client's id in the sign-in service (standard 001); it is the `aud` of the ID token. */
export const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID ?? "moli-todo-app";
/** Sent on every request so the server can tell an app that is too old to update (426). */
export const CLIENT_NAME = `todo-desktop/${__APP_VERSION__}`;

/** Pull this often while the widget is open (standard 009, 9.7.3). */
export const REFRESH_MS = 15 * 60 * 1000;
