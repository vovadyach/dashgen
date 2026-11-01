import type { Chart } from "@dashgen/contracts";
import { describe, expect, it } from "vitest";

import { chartFromLink, chartLink } from "../src/share.ts";
import { CHART } from "./fixtures/run.ts";

const hashOf = (link: string) => new URL(link).hash;

describe("share links", () => {
  it("carry the chart, and give it back", async () => {
    const link = await chartLink(CHART);
    expect(link.startsWith(`${location.origin}/#chart=`)).toBe(true);
    expect(await chartFromLink(hashOf(link))).toEqual(CHART);
  });

  it("give nothing for a hash that isn't a link, or a link cut short", async () => {
    expect(await chartFromLink("")).toBeUndefined();
    expect(await chartFromLink("#about")).toBeUndefined();
    expect(await chartFromLink("#chart=not*base64")).toBeUndefined();
    const hash = hashOf(await chartLink(CHART));
    expect(await chartFromLink(hash.slice(0, 40))).toBeUndefined();
  });

  it("give nothing for a link that carries something other than a chart", async () => {
    const radar = { ...CHART, type: "radar" } as unknown as Chart;
    expect(await chartFromLink(hashOf(await chartLink(radar)))).toBeUndefined();
  });

  it("give nothing for a short link that unpacks to too much", async () => {
    // Two million of one letter pack into a few KB.
    const huge = { ...CHART, title: "a".repeat(2_000_000) };
    const hash = hashOf(await chartLink(huge));
    expect(hash.length).toBeLessThan(50_000);
    expect(await chartFromLink(hash)).toBeUndefined();
  });

  it("give nothing for a link too long to be one of ours", async () => {
    expect(await chartFromLink(`#chart=${"A".repeat(60_000)}`)).toBeUndefined();
  });
});
