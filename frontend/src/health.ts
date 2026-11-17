import { Health } from "@dashgen/contracts";
import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";

/** How long GET /api/health has to answer before DashGen counts as offline (ADR-0003). */
const TIMEOUT_MS = 3000;

/**
 * Whether DashGen's backend is up: GET /api/health answered within 3
 * seconds, with a 200 and {"status": "ok"}. Anything else is offline:
 * CloudFront's 503 between sessions, its own 502 or 504 page, no answer in
 * time, or no network.
 */
async function isOnline(): Promise<boolean> {
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
    return (
      response.status === 200 && Health.safeParse(await response.json()).success
    );
  } catch {
    // No answer in time, no network, or a body that isn't JSON.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The page's check of the backend, as TanStack Query runs it: once as the
 * page opens, then only while DashGen is offline, each time the tab comes
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
});

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
