import { type Chart, SAMPLE_SERVICES } from "@dashgen/contracts";
import { describe, expect, it } from "vitest";

import { chartFromLink, chartLink } from "../src/share.ts";
import { CHART, HOURS, TOO_LARGE_FOR_A_LINK } from "./fixtures/run.ts";
import { linkTo } from "./helpers/link.ts";

const hashOf = (link: string) => new URL(link).hash;

/**
 * The hash of a link written by hand, which can carry anything, packed as
 * the page packs a chart.
 */
async function written(value: unknown): Promise<string> {
  const packed = new Response(JSON.stringify(value)).body?.pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  let binary = "";
  for (const byte of new Uint8Array(await new Response(packed).arrayBuffer())) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
  return `#chart=${base64.replace(/=+$/, "")}`;
}

describe("share links", () => {
  it("carry the chart, and give it back", async () => {
    const link = await linkTo(CHART);
    expect(link.startsWith(`${location.origin}/#chart=`)).toBe(true);
    expect(await chartFromLink(hashOf(link))).toEqual(CHART);
  });

  it("give nothing for a hash that isn't a link, or a link cut short", async () => {
    expect(await chartFromLink("")).toBeUndefined();
    expect(await chartFromLink("#about")).toBeUndefined();
    expect(await chartFromLink("#chart=not*base64")).toBeUndefined();
    const hash = hashOf(await linkTo(CHART));
    expect(await chartFromLink(hash.slice(0, 40))).toBeUndefined();
  });

  it("give nothing for a link that carries something other than a chart", async () => {
    expect(
      await chartFromLink(await written({ ...CHART, type: "radar" })),
    ).toBeUndefined();
  });

  it("give nothing for a link whose hours or days aren't real times", async () => {
    for (const x of ["not a date", "2026-02-31T00:00:00.000Z", ""]) {
      const chart = {
        ...CHART,
        series: [{ name: "payments-service", points: [{ x, y: 1 }] }],
      };
      expect(await chartFromLink(await written(chart))).toBeUndefined();
    }
    // Services are names, not times.
    const pie: Chart = {
      ...CHART,
      type: "pie",
      x: "category",
      series: [{ name: "errors", points: [{ x: "checkout-api", y: 3 }] }],
    };
    expect(await chartFromLink(hashOf(await linkTo(pie)))).toEqual(pie);
  });

  it("give nothing for a short link that unpacks to too much", async () => {
    // Two million of one letter pack into a few KB.
    const hash = await written({ ...CHART, title: "a".repeat(2_000_000) });
    expect(hash.length).toBeLessThan(50_000);
    expect(await chartFromLink(hash)).toBeUndefined();
  });

  it("give nothing for a short link that holds more points than any chart DashGen makes", async () => {
    // Repeated points compress to almost nothing: 20,000 of them fit in a
    // link far under both size caps.
    const crowded: Chart = {
      ...CHART,
      series: [
        {
          name: "payments-service",
          points: Array.from({ length: 20_000 }, () => ({
            x: "2026-10-25T00:00:00.000Z",
            y: 0,
          })),
        },
      ],
    };
    const hash = await written(crowded);
    expect(hash.length).toBeLessThan(10_000);
    expect(await chartFromLink(hash)).toBeUndefined();
  });

  it("carry the largest chart the backend makes: five services by the hour over 30 days", async () => {
    const largest: Chart = {
      ...CHART,
      x: "hour",
      unit: "ms",
      series: SAMPLE_SERVICES.map((name, s) => ({
        name,
        points: HOURS.map((x, i) => ({
          x,
          y: 80 + ((i * 7919 + s * 31) % 97),
        })),
      })),
    };
    expect(await chartFromLink(hashOf(await linkTo(largest)))).toEqual(largest);
  });

  it("make no link for a chart too large to open as one", async () => {
    expect(await chartLink(TOO_LARGE_FOR_A_LINK)).toBeUndefined();
    // Packs small, but unpacks to more than a link may hold.
    const long = { ...CHART, unit: "a".repeat(2_000_000) };
    expect(await chartLink(long)).toBeUndefined();
  });

  it("give nothing for a link too long to be one of ours", async () => {
    expect(await chartFromLink(`#chart=${"A".repeat(60_000)}`)).toBeUndefined();
  });
});
