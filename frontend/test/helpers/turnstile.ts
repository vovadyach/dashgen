import type { Turnstile } from "../../src/bot-check.ts";

type RenderOptions = Parameters<Turnstile["render"]>[1];

/**
 * Cloudflare's widget, as a fake: the test hands out each token with
 * `issue()`, and `resets` counts the times the page asked for a new one.
 */
export function fakeTurnstile() {
  let options: RenderOptions | undefined;
  const resets: string[] = [];
  const turnstile: Turnstile = {
    render: (_container, given) => {
      options = given;
      return "widget-1";
    },
    reset: (widget) => {
      resets.push(widget);
    },
  };
  return {
    turnstile,
    issue: (token: string) => {
      options?.callback(token);
    },
    /** What the page rendered the widget with. */
    options: () => options,
    resets,
  };
}

/** The promises in flight settle, like Turnstile's script loading. */
export const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};
