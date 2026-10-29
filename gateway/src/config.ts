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

// Empty values fail like missing ones, so `GEMINI_API_KEY=` stops the gateway at startup.
const Env = z.object({
  GEMINI_API_KEY: z.string().min(1),
  // Only http and https: the gateway calls the metrics service over HTTP.
  METRICS_BASE_URL: z.url({ protocol: /^https?$/ }),
  ALLOWED_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    )
    .pipe(z.array(z.string()).min(1)),
});

/** Gateway settings, read from environment variables. */
export interface Config {
  geminiApiKey: Secret;
  metricsBaseUrl: string;
  allowedOrigins: string[];
}

/** Reads the settings from `env`, and throws an error naming every missing or invalid variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = Env.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return {
    geminiApiKey: new Secret(result.data.GEMINI_API_KEY),
    metricsBaseUrl: result.data.METRICS_BASE_URL,
    allowedOrigins: result.data.ALLOWED_ORIGINS,
  };
}
