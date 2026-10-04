import { z } from "zod";

/** Body of every error response from the API. */
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** `GET /api/v1/me`: who the server thinks you are. */
export const meResponseSchema = z.object({
  /** `preferred_username`, lower-cased: the `owner` of everything the user has. */
  username: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  /** How the request was authenticated: browser cookie or desktop bearer token. */
  via: z.enum(["session", "bearer"]),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
