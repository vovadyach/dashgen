import { Health } from "@dashgen/contracts";
import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";

/** How long GET /api/health has to answer before DashGen counts as offline (ADR-0003). index.html's check gives it the same. */
export const TIMEOUT_MS = 3000;

/** What GET /api/health answered, or null: no answer in time, no network, or a body that isn't JSON. */
type HealthAnswer = { status: number; body: unknown } | null;

/**
 * The check index.html starts while the page's code downloads, so the first
 * render can know its answer (ADR-0020): the check, and its answer once
 * it's in.
 */
interface EarlyCheck {
  check: Promise<HealthAnswer>;
  answer?: HealthAnswer;
}

declare global {
  interface Window {
    dashgenHealth?: EarlyCheck;
  }
}

/**
 * Whether DashGen's backend is up: GET /api/health answered within 3
 * seconds, with a 200 and {"status": "ok"}. Anything else is offline:
 * CloudFront's 503 between sessions, its own 502 or 504 page, no answer in
 * time, or no network.
 */
const isUp = (answer: HealthAnswer) =>
  answer !== null &&
  answer.status === 200 &&
  Health.safeParse(answer.body).success;

async function isOnline(): Promise<boolean> {
  // The page's first check is the one index.html started, if it did.
  return isUp(await (takeEarlyCheck()?.check ?? askHealth()));
}

/** Asks GET /api/health, with 3 seconds to answer. index.html's check does the same. */
async function askHealth(): Promise<HealthAnswer> {
  // A timer of its own, not AbortSignal.timeout(): the tests' fake timers
  // can't move that one's clock.
  const timeout = new AbortController();
  const timer = setTimeout(() => {
    timeout.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch("/api/health", {
      // Never an answer the browser kept, which could outlive the backend.
      cache: "no-store",
      signal: timeout.signal,
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** index.html's check, once: after it, the page asks for itself. */
function takeEarlyCheck(): EarlyCheck | undefined {
  const early = window.dashgenHealth;
  delete window.dashgenHealth;
  return early;
}

/**
 * The page's check of the backend, as TanStack Query runs it: once as the
 * page opens, started by index.html, then only while DashGen is offline, each time the tab comes
 * back into view, so a session that started meanwhile turns the page back
 * on. No polling, and no checks while it's online.
 */
const online = queryOptions({
  queryKey: ["online"],
  queryFn: isOnline,
  // isOnline() never fails: no answer means offline.
  retry: false,
  // With no network, the check still runs, and finds DashGen offline.
  networkMode: "always",
  // TanStack Query's "focus" is the tab coming into view: visibilitychange.
  refetchOnWindowFocus: (query) => query.state.data === false,
  refetchOnReconnect: false,
  // An answer seedOnline() gave the first render counts as the first check.
  refetchOnMount: false,
});

/**
 * Gives the first render the answer of index.html's check, if it's in, so
 * an offline banner is in the page's first frame instead of pushing the page
 * down a moment later. main.tsx calls it once, before React renders. Until
 * the check answers, the page counts as online, as before.
 */
export function seedOnline(client: QueryClient) {
  const answer = window.dashgenHealth?.answer;
  if (answer === undefined) return;
  takeEarlyCheck();
  client.setQueryData(online.queryKey, isUp(answer));
}

/**
 * Resolves the first time a check finds DashGen online: at once if one
 * already has, or later, as when a session starts while the tab is open.
 * Unlike useOffline(), it waits for a check, so it never resolves while
 * DashGen is offline, and nobody can ask.
 */
export function onceOnline(client: QueryClient): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (client.getQueryData(online.queryKey) !== true) return;
      stop();
      resolve();
    };
    const stop = client.getQueryCache().subscribe(check);
    check();
  });
}

/**
 * Whether DashGen is offline, as the page last found it. Until the first
 * check answers, it counts as online, so the page doesn't open with its
 * question box off.
 */
export function useOffline(): boolean {
  return useQuery(online).data === false;
}

/**
 * Counts DashGen as offline with no check of its own, as when a question
 * gets CloudFront's offline 503: no session runs. A check still on its way
 * is dropped first: it went out earlier, and its late "ok" would hide the
 * banner.
 */
export async function markOffline(client: QueryClient) {
  await client.cancelQueries({ queryKey: online.queryKey });
  client.setQueryData(online.queryKey, false);
}
