import {
  Chart,
  CHART_LINK_PREFIX,
  chartHash,
  chartJsonFromHash,
} from "@dashgen/contracts";

// A share link carries the chart itself, compressed, after the address's #.
// Browsers never send that part to a server, so a link needs no backend,
// and it still opens after the AWS stack is torn down (ADR-0013). The format
// is in @dashgen/contracts, since the MCP server makes these links too.

/** Whether an address's hash, like `location.hash`, is a share link. */
export const isChartLink = (hash: string) => hash.startsWith(CHART_LINK_PREFIX);

/**
 * A link to this page that opens `chart`, with no run, or undefined when the
 * link would be too long to open.
 */
export async function chartLink(chart: Chart): Promise<string | undefined> {
  const hash = await chartHash(chart);
  return hash && `${location.origin}${location.pathname}${hash}`;
}

/**
 * The chart in a share link's hash. Anyone can write a link, so what it
 * carries is parsed like the backend's answers, and anything else, like a
 * link cut short, gives undefined.
 */
export async function chartFromLink(hash: string): Promise<Chart | undefined> {
  const json = await chartJsonFromHash(hash);
  if (json === undefined) return undefined;
  try {
    const parsed = Chart.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not JSON.
    return undefined;
  }
}
