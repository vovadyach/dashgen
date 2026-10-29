/**
 * The logger the backend's modules take as a parameter. Fastify's logger
 * (Pino) fits it. Log where a problem is noticed or handled, once:
 * - debug: detail for development, like each SQL statement or query.
 * - info: normal events worth keeping, like a finished run.
 * - warn: something's off but was handled, like missing data or a retry.
 * - error: something failed and couldn't be handled.
 */
export interface Logger {
  debug(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** From most to least severe. */
export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Prints lines at `level` and above, for scripts and tests. */
export function consoleLogger(level: LogLevel = "warn"): Logger {
  const shown = (line: LogLevel) =>
    LOG_LEVELS.indexOf(line) <= LOG_LEVELS.indexOf(level);
  return {
    error: (obj, msg) => {
      if (shown("error")) console.error(msg, obj);
    },
    warn: (obj, msg) => {
      if (shown("warn")) console.warn(msg, obj);
    },
    info: (obj, msg) => {
      if (shown("info")) console.info(msg, obj);
    },
    debug: (obj, msg) => {
      if (shown("debug")) console.debug(msg, obj);
    },
  };
}
