import type { Logger, LogLevel } from "../../src/logger.ts";

export interface LogLine {
  level: LogLevel;
  obj: object;
  msg: string;
}

/** A logger that records its lines, so a test can check what was logged. */
export function recordingLogger(): { log: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLevel) =>
    (obj: object, msg: string): void => {
      lines.push({ level, obj, msg });
    };
  return {
    log: {
      error: at("error"),
      warn: at("warn"),
      info: at("info"),
      debug: at("debug"),
    },
    lines,
  };
}
