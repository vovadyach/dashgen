import { inspect } from "node:util";

import { z } from "zod";

import { LOG_LEVELS, type LogLevel } from "./logger.ts";

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
  // The cost estimates in docs/design.md are for this model's prices. Gemini 3
  // only: the adapter sets a thinking level and sends thought signatures back.
  GEMINI_MODEL: z
    .string()
    .regex(
      /^gemini-3[.-]/,
      "Use a Gemini 3 model, like gemini-3.1-flash-lite: DashGen sets its thinking level and sends its thought signatures back.",
    )
    .default("gemini-3.1-flash-lite"),
  ALLOWED_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    )
    .pipe(z.array(z.string()).min(1)),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

/** Backend settings, read from environment variables. */
export interface Config {
  geminiApiKey: Secret;
  geminiModel: string;
  allowedOrigins: string[];
  // debug adds every SQL statement; info suits AWS.
  logLevel: LogLevel;
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
  const { GEMINI_API_KEY, GEMINI_MODEL, ALLOWED_ORIGINS, LOG_LEVEL } = parseEnv(
    Env,
    env,
  );
  return {
    geminiApiKey: new Secret(GEMINI_API_KEY),
    geminiModel: GEMINI_MODEL,
    allowedOrigins: ALLOWED_ORIGINS,
    logLevel: LOG_LEVEL,
  };
}

const GeminiEnv = Env.pick({ GEMINI_API_KEY: true, GEMINI_MODEL: true });

/** Reads the Gemini key and model alone, for scripts that don't need the backend's other settings. */
export function loadGeminiSettings(env: NodeJS.ProcessEnv = process.env): {
  apiKey: Secret;
  model: string;
} {
  const { GEMINI_API_KEY, GEMINI_MODEL } = parseEnv(GeminiEnv, env);
  return { apiKey: new Secret(GEMINI_API_KEY), model: GEMINI_MODEL };
}

const DatabaseEnv = z.object({
  // A host is required too: `postgres:/oops` is a valid URL, but connects nowhere useful.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /.+/ }),
});

/** Reads `DATABASE_URL`, which holds a password, so it comes back as a `Secret`. */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): Secret {
  return new Secret(parseEnv(DatabaseEnv, env).DATABASE_URL);
}

const LogLevelEnv = z.object({ LOG_LEVEL: z.enum(LOG_LEVELS).default("info") });

/** Reads `LOG_LEVEL` alone, for scripts that don't need the backend's other settings. */
export function loadLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  return parseEnv(LogLevelEnv, env).LOG_LEVEL;
}
