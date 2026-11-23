// Cloudflare Turnstile's check that a person asks each question (ADR-0021).
// An invisible widget keeps a token ready, and each question takes it with
// it to POST /api/ask, where the backend checks it with Cloudflare. A token
// works once, so the widget makes the next as soon as one is taken.

/** Cloudflare's test site key, which passes everyone, invisibly: for development, and any build without VITE_TURNSTILE_SITE_KEY. */
export const TEST_SITE_KEY = "1x00000000000000000000BB";

/** Cloudflare's script, which must load from Cloudflare itself. */
export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** How long a question waits for a token, before it goes without one and the backend turns it down. */
export const TOKEN_WAIT_MS = 5_000;

/** The part of Turnstile's API the page uses. */
export interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      // No hidden form field: the page sends the token itself.
      "response-field": boolean;
    },
  ): string | undefined;
  reset(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** The page's check: started once, then a token for each question. */
export interface BotCheck {
  /**
   * Loads Cloudflare's script and renders the widget, once `when` resolves,
   * at once without it. From the call on, questions wait for a token, so
   * one asked before the script has loaded gets one too.
   */
  start: (when?: Promise<void>) => void;
  /** A token for the next question: the one that's ready, or the next within 5 seconds, or none. */
  token: () => Promise<string | undefined>;
}

export function createBotCheck(
  load: () => Promise<Turnstile>,
  siteKey: string,
  waitMs = TOKEN_WAIT_MS,
): BotCheck {
  let state: "idle" | "started" | "broken" = "idle";
  let turnstile: Turnstile | undefined;
  let widget: string | undefined;
  let ready: string | undefined;
  // Questions waiting for a token, oldest first.
  const waiting: ((token: string | undefined) => void)[] = [];

  // The token just used is spent, so the widget makes another.
  const next = () => {
    if (turnstile && widget !== undefined) turnstile.reset(widget);
  };
  const take = (token: string) => {
    const waiter = waiting.shift();
    if (!waiter) {
      ready = token;
      return;
    }
    waiter(token);
    next();
  };
  const giveUp = () => {
    state = "broken";
    for (const waiter of waiting.splice(0)) waiter(undefined);
  };

  return {
    start: (when = Promise.resolve()) => {
      if (state !== "idle") return;
      state = "started";
      when.then(load).then(
        (loaded) => {
          turnstile = loaded;
          const container = document.createElement("div");
          document.body.append(container);
          widget = loaded.render(container, {
            sitekey: siteKey,
            callback: take,
            "expired-callback": () => {
              ready = undefined;
            },
            "error-callback": () => {
              ready = undefined;
            },
            "response-field": false,
          });
        },
        // An ad blocker, or no network: no tokens will come.
        giveUp,
      );
    },
    token: () => {
      if (state !== "started") return Promise.resolve(undefined);
      if (ready !== undefined) {
        const token = ready;
        ready = undefined;
        next();
        return Promise.resolve(token);
      }
      return new Promise((resolve) => {
        const waiter = (token: string | undefined) => {
          clearTimeout(timer);
          resolve(token);
        };
        const timer = setTimeout(() => {
          const index = waiting.indexOf(waiter);
          if (index !== -1) waiting.splice(index, 1);
          resolve(undefined);
        }, waitMs);
        waiting.push(waiter);
      });
    },
  };
}

/** Loads Cloudflare's script, unless the page already has it. */
function loadCloudflare(): Promise<Turnstile> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile's script loaded without Turnstile"));
    };
    script.onerror = () => {
      reject(new Error("Turnstile's script didn't load"));
    };
    document.head.append(script);
  });
}

const pageCheck = createBotCheck(
  loadCloudflare,
  import.meta.env.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY,
);

/** main.tsx starts it as the page opens, to load once DashGen is online. Tests never do. */
export const startBotCheck = pageCheck.start;

/** The token for the next question, or none: before startBotCheck, as in tests, there's none at once. */
export const botCheckToken = pageCheck.token;
