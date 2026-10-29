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

/** For scripts and tests: warnings and errors print, the rest stays quiet. */
export const consoleLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (obj, msg) => {
    console.warn(msg, obj);
  },
  error: (obj, msg) => {
    console.error(msg, obj);
  },
};
