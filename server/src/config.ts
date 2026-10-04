import { z } from "zod";

const envSchema = z.object({
  /** Public origin of the site, e.g. https://todo.xiangyu.pro (no path, no trailing slash). */
  APP_URL: z
    .url()
    .refine((value) => new URL(value).origin === value, "must be an origin without a path"),
  OIDC_ISSUER: z.url(),
  /** The web client (confidential). */
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  /** The desktop client (public); its id is the expected `aud` of bearer tokens. */
  OIDC_NATIVE_CLIENT_ID: z.string().min(1),
  DATABASE_PATH: z.string().min(1).default("./data/todo.db"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  APP_VERSION: z.string().min(1).default("dev"),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Directory of the built web UI. */
  WEB_DIST: z.string().default("./dist/web"),
});

export type Config = z.infer<typeof envSchema>;

/** Reads and validates the environment. Throws a readable error naming every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  }
  return parsed.data;
}
