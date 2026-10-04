import { meResponseSchema, type MeResponse } from "@shared/api";

/** The server answers 401 JSON when the session is gone; the page then goes back through sign-in. */
export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function fetchMe(fetchFn: typeof fetch = fetch): Promise<MeResponse> {
  const response = await fetchFn("/api/v1/me", { headers: { accept: "application/json" } });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`request failed: ${response.status}`);
  return meResponseSchema.parse(await response.json());
}

export function signInUrl(location: Pick<Location, "pathname" | "search">): string {
  return `/auth/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}
