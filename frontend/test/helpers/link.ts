import type { Chart } from "@dashgen/contracts";

import { chartLink } from "../../src/share.ts";

/** A share link to `chart`, which must be small enough to get one. */
export async function linkTo(chart: Chart): Promise<string> {
  const link = await chartLink(chart);
  if (link === undefined) throw new Error(`No link for "${chart.title}"`);
  return link;
}
