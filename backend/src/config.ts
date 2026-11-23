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

/** Questions a day, for every visitor together, unless DAILY_CAP says otherwise (docs/design.md, the daily cap). */
export const DEFAULT_DAILY_CAP = 150;

/** Dollars per million tokens. */
export interface Price {
  input: number;
  output: number;
}

/** Who runs a model, which decides its adapter (agent/models.ts) and its key. */
export type Provider = "gemini" | "claude";

/**
 * The models AI_MODEL can name, each with its provider and its prices, for
 * each run's cost (docs/design.md, the daily cap; prices from October 2026).
 * Gemini 3 only: its adapter sets a thinking level and sends thought
 * signatures back. Claude Haiku 5.5 only: Sonnet 5.5 and Opus 5.5 can't be
 * forced to call a tool, which its adapter relies on. Its prices are for
 * prompts up to 100K tokens, and a question's whole conversation stays under
 * 24,000. The session
 * stack names the same models, to check TF_VAR_ai_model before AWS makes
 * anything (model_providers in infra/aws/session/secrets.tf), and a test keeps
 * the two the same.
 */
export const MODELS = {
  "gemini-3.1-flash-lite": {
    provider: "gemini",
    price: { input: 0.25, output: 1.5 },
  },
  "gemini-3.5-flash-lite": {
    provider: "gemini",
    price: { input: 0.3, output: 2.5 },
  },
  "claude-haiku-5-5": {
    provider: "claude",
    price: { input: 0.1, output: 0.5 },
  },
} as const satisfies Record<string, { provider: Provider; price: Price }>;
type ModelName = keyof typeof MODELS;
const MODEL_NAMES = Object.keys(MODELS) as [ModelName, ...ModelName[]];

/** The variable that holds each provider's key. */
const KEY_VARIABLES = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
} as const satisfies Record<Provider, string>;

const modelFields = {
  // The cost estimates in docs/design.md are for this model.
  AI_MODEL: z
    .enum(MODEL_NAMES, {
      error: `Use ${MODEL_NAMES.join(", ")}: the models DashGen has an adapter and prices for.`,
    })
    .default("gemini-3.1-flash-lite"),
  // Only the chosen model's key is needed (checkModelKey).
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // The old name. Left in a .env, it would otherwise be ignored without a word.
  GEMINI_MODEL: z
    .never({ error: "GEMINI_MODEL is now AI_MODEL: rename it." })
    .optional(),
};

interface ModelEnvValues {
  AI_MODEL: ModelName;
  GEMINI_API_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
}

/**
 * Stops the backend at startup without the key its model needs. An empty
 * value counts as missing, so `ANTHROPIC_API_KEY=` stops it too.
 */
function checkModelKey(env: ModelEnvValues, ctx: z.RefinementCtx): void {
  const variable = KEY_VARIABLES[MODELS[env.AI_MODEL].provider];
  if (!env[variable]) {
    ctx.addIssue({
      code: "custom",
      path: [variable],
      message: `${env.AI_MODEL} needs ${variable}.`,
    });
  }
}

const Env = z
  .object({
    ...modelFields,
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
    // A whole number above 0, so a typo can't switch the cap off.
    DAILY_CAP: z.coerce.number().int().min(1).default(DEFAULT_DAILY_CAP),
    // Where the backend listens. In a container, localhost is the container's
    // own, so the Dockerfile sets 0.0.0.0.
    HOST: z.string().min(1).default("localhost"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    // On AWS, the header that holds the visitor's IP, which only CloudFront's
    // function sets (ADR-0003), since every connection there comes from the
    // load balancer. Unset locally, where a connection's own address is the
    // visitor's. Lowercase, as Node gives header names.
    VIEWER_IP_HEADER: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    // Cloudflare Turnstile's secret key, to check that a person asks each
    // question (ADR-0021). Unset or empty, as locally, there's no check. On
    // AWS it's required (checkBotCheckKey).
    TURNSTILE_SECRET_KEY: z.string().optional(),
    // Only the backend's task definition sets it, so it says the backend runs
    // on AWS. loadDynamoTarget reads it for the daily cap.
    DYNAMODB_REGION: z.string().optional(),
  })
  .superRefine(checkModelKey)
  .superRefine(checkBotCheckKey);

/**
 * Cloudflare's test secret keys, like 1x0000000000000000000000000000000AA,
 * which take only the test widget's dummy token, and turn every real one
 * down (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 */
const TEST_SECRET_KEY = /^\dx0+AA$/;

/**
 * Stops the backend at startup on AWS without Turnstile's secret key, or with
 * one of Cloudflare's test keys (ADR-0021). A task made from an older
 * template would otherwise run with no bot check, and let bots use up the
 * day's questions, and a test key would turn every visitor down.
 */
function checkBotCheckKey(
  env: {
    TURNSTILE_SECRET_KEY?: string | undefined;
    DYNAMODB_REGION?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (!env.DYNAMODB_REGION) return;
  if (!env.TURNSTILE_SECRET_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["TURNSTILE_SECRET_KEY"],
      message:
        "On AWS, where DYNAMODB_REGION is set, the bot check needs TURNSTILE_SECRET_KEY.",
    });
  } else if (TEST_SECRET_KEY.test(env.TURNSTILE_SECRET_KEY)) {
    ctx.addIssue({
      code: "custom",
      path: ["TURNSTILE_SECRET_KEY"],
      message:
        "On AWS, TURNSTILE_SECRET_KEY can't be one of Cloudflare's test keys, which turn every real visitor down.",
    });
  }
}

/** The model that answers questions: AI_MODEL's, with its provider's key. */
export interface ModelSettings {
  /** Like "gemini-3.1-flash-lite". */
  name: string;
  provider: Provider;
  apiKey: Secret;
  /** For each run's cost. */
  price: Price;
}

/** AI_MODEL's settings, once checkModelKey has passed. */
function modelSettings(env: ModelEnvValues): ModelSettings {
  const { provider, price } = MODELS[env.AI_MODEL];
  return {
    name: env.AI_MODEL,
    provider,
    // checkModelKey made sure it's there.
    apiKey: new Secret(env[KEY_VARIABLES[provider]] ?? ""),
    price,
  };
}

/** Backend settings, read from environment variables. */
export interface Config {
  model: ModelSettings;
  allowedOrigins: string[];
  // debug adds every SQL statement; info suits AWS.
  logLevel: LogLevel;
  /** Questions a day, for every visitor together. */
  dailyCap: number;
  /** The address and port the backend listens on. */
  host: string;
  port: number;
  /** The header with the visitor's IP, for the rate limit; unset, the connection's address. */
  viewerIpHeader: string | undefined;
  /** Cloudflare Turnstile's secret key, which checks each question's token; unset, no check. */
  turnstileSecret: Secret | undefined;
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
  const parsed = parseEnv(Env, env);
  const {
    ALLOWED_ORIGINS,
    LOG_LEVEL,
    DAILY_CAP,
    HOST,
    PORT,
    VIEWER_IP_HEADER,
    TURNSTILE_SECRET_KEY,
  } = parsed;
  return {
    model: modelSettings(parsed),
    allowedOrigins: ALLOWED_ORIGINS,
    logLevel: LOG_LEVEL,
    dailyCap: DAILY_CAP,
    host: HOST,
    port: PORT,
    viewerIpHeader: VIEWER_IP_HEADER,
    turnstileSecret: TURNSTILE_SECRET_KEY
      ? new Secret(TURNSTILE_SECRET_KEY)
      : undefined,
  };
}

const ModelEnv = z.object(modelFields).superRefine(checkModelKey);

/** Reads AI_MODEL and its key alone, for scripts that don't need the backend's other settings. */
export function loadModelSettings(
  env: NodeJS.ProcessEnv = process.env,
): ModelSettings {
  return modelSettings(parseEnv(ModelEnv, env));
}

const DatabaseEnv = z.object({
  // A host is required too: `postgres:/oops` is a valid URL, but connects nowhere useful.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /.+/ }),
});

/**
 * Reads `DATABASE_URL`, which can hold a password, so it comes back as a
 * `Secret`. On AWS it holds none: ECS sets `PGPASSWORD`, which node-postgres
 * reads itself (ADR-0015).
 */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): Secret {
  return new Secret(parseEnv(DatabaseEnv, env).DATABASE_URL);
}

const DynamoEnv = z.object({
  // DynamoDB Local, which `make db` starts.
  DYNAMODB_ENDPOINT: z.url({ protocol: /^https?$/, hostname: /.+/ }).optional(),
  // AWS's own DynamoDB, like us-east-1. Only the backend's task definition sets
  // it (infra/aws/session).
  DYNAMODB_REGION: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]+)+-\d+$/)
    .optional(),
});

/**
 * Where the daily cap keeps its count: DynamoDB Local at `endpoint`, or AWS's
 * own DynamoDB in `region`, with the ECS task's role.
 */
export type DynamoTarget = { endpoint: string } | { region: string };

/**
 * Reads where the daily cap keeps its count: DynamoDB Local at
 * `DYNAMODB_ENDPOINT`, by default http://localhost:8000, or AWS's own DynamoDB
 * when `DYNAMODB_REGION` is set, as on ECS. AWS takes that one explicit
 * setting, never both, so a run on a developer's machine can't reach it by
 * accident. Set on purpose there, it finds no ECS task's credentials, and
 * each reservation fails, so only the task definition sets it.
 */
export function loadDynamoTarget(
  env: NodeJS.ProcessEnv = process.env,
): DynamoTarget {
  const { DYNAMODB_ENDPOINT, DYNAMODB_REGION } = parseEnv(DynamoEnv, env);
  if (DYNAMODB_REGION === undefined) {
    return { endpoint: DYNAMODB_ENDPOINT ?? "http://localhost:8000" };
  }
  if (DYNAMODB_ENDPOINT !== undefined) {
    throw new Error(
      "Set DYNAMODB_ENDPOINT for DynamoDB Local, or DYNAMODB_REGION for AWS's own DynamoDB, not both.",
    );
  }
  return { region: DYNAMODB_REGION };
}

const LogLevelEnv = z.object({ LOG_LEVEL: z.enum(LOG_LEVELS).default("info") });

/** Reads `LOG_LEVEL` alone, for scripts that don't need the backend's other settings. */
export function loadLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  return parseEnv(LogLevelEnv, env).LOG_LEVEL;
}
