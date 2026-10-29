import { inspect } from "node:util";

import { z } from "zod";

/** A string that stays hidden when it's logged, printed or turned into JSON. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return "[hidden]";
  }

  toString(): string {
    return "[hidden]";
  }

  [inspect.custom](): string {
    return "Secret([hidden])";
  }
}

// Empty values fail like missing ones, so `GEMINI_API_KEY=` stops the backend at startup.
const Env = z.object({
  GEMINI_API_KEY: z.string().min(1),
  ALLOWED_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    )
    .pipe(z.array(z.string()).min(1)),
  // debug adds every SQL statement; info suits AWS.
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
});

/** Backend settings, read from environment variables. */
export interface Config {
  geminiApiKey: Secret;
  allowedOrigins: string[];
  logLevel: "error" | "warn" | "info" | "debug";
}

/** Parses `env` with `schema`, and throws an error naming every missing or invalid variable. */
function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv,
): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/** Reads the backend's settings from `env`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { GEMINI_API_KEY, ALLOWED_ORIGINS, LOG_LEVEL } = parseEnv(Env, env);
  return {
    geminiApiKey: new Secret(GEMINI_API_KEY),
    allowedOrigins: ALLOWED_ORIGINS,
    logLevel: LOG_LEVEL,
  };
}

const DatabaseEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

/** Reads `DATABASE_URL`, which holds a password, so it comes back as a `Secret`. */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): Secret {
  return new Secret(parseEnv(DatabaseEnv, env).DATABASE_URL);
}
