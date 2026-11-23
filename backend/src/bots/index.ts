import type { Secret } from "../config.ts";
import type { Logger } from "../logger.ts";
import { Verdict } from "./types.ts";

/** Where Cloudflare checks a Turnstile token. */
export const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * What the bot check made of a question (ADR-0021): a person asked, or
 * Cloudflare is down; a bot asked, or a visitor without a token; or DashGen's
 * own setup is wrong, as with a mistyped secret key, which only its operator
 * can fix.
 */
export type BotVerdict = "passed" | "failed" | "misconfigured";

/**
 * Whether a person asks a question, from its Cloudflare Turnstile token.
 * POST /api/ask checks it before the daily cap, so a bot takes none of
 * today's questions.
 */
export interface BotCheck {
  /**
   * The verdict on `token`, from the visitor at `ip`. "passed" too when
   * Cloudflare is down: no answer within 3 seconds, a 5xx or a 429, or its
   * own internal-error. An outage there then doesn't stop the demo, and the
   * daily cap still bounds what questions cost. Never rejects.
   */
  check(
    token: string | undefined,
    ip: string,
    log: Logger,
  ): Promise<BotVerdict>;
}

/** No check, as without TURNSTILE_SECRET_KEY: every question passes. */
export const NO_BOT_CHECK: BotCheck = {
  check: () => Promise.resolve("passed"),
};

export interface BotCheckOptions {
  /** Cloudflare's API, or a test's fake. */
  fetch?: typeof fetch;
  /** How long Cloudflare has to answer. */
  timeoutMs?: number;
}

/** Cloudflare's codes for a request only DashGen's operator can fix, like a wrong secret key. */
const SETUP_ERRORS: ReadonlySet<string> = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
]);

/** Checks tokens with Cloudflare, with the secret key of DashGen's widget. */
export function createBotCheck(
  secret: Secret,
  { fetch = globalThis.fetch, timeoutMs = 3_000 }: BotCheckOptions = {},
): BotCheck {
  return {
    async check(token, ip, log) {
      // Cloudflare's own name for it.
      if (token === undefined || token === "") {
        log.info({ errors: ["missing-input-response"] }, "bot check failed");
        return "failed";
      }
      let response: Response;
      try {
        response = await fetch(SITEVERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            secret: secret.reveal(),
            response: token,
            remoteip: ip,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // No answer in time, or no network.
        log.warn({ err }, "bot check unavailable");
        return "passed";
      }
      const { status } = response;
      // Cloudflare is down, or too busy for DashGen.
      const outage = status >= 500 || status === 429;
      let text: string;
      try {
        text = await response.text();
      } catch (err) {
        // The answer stopped partway, or stalled past the timeout. Any other
        // 4xx turned the request down, maybe for a wrong secret key, so the
        // question mustn't pass, nor be blamed on a bot.
        if (status >= 400 && !outage) {
          log.error({ err, status }, "bot check misconfigured");
          return "misconfigured";
        }
        log.warn({ err, status }, "bot check unavailable");
        return "passed";
      }
      if (outage) {
        log.warn({ status }, "bot check unavailable");
        return "passed";
      }
      // A verdict counts whatever the HTTP status: Cloudflare answers a wrong
      // secret key with a 400 and a verdict.
      const verdict = Verdict.safeParse(parseJson(text));
      if (!verdict.success) {
        // Like a 404's page: DashGen asks the wrong way.
        log.error({ status }, "bot check misconfigured");
        return "misconfigured";
      }
      if (verdict.data.success) return "passed";
      const errors = verdict.data["error-codes"];
      // Cloudflare's own failure, not the token's: as if it hadn't answered.
      if (errors.includes("internal-error")) {
        log.warn({ errors }, "bot check unavailable");
        return "passed";
      }
      if (errors.some((code) => SETUP_ERRORS.has(code))) {
        log.error({ errors }, "bot check misconfigured");
        return "misconfigured";
      }
      log.info({ errors }, "bot check failed");
      return "failed";
    },
  };
}

/** `text` as JSON, or undefined when it isn't JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
