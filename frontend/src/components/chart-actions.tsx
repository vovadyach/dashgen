import type { Chart } from "@dashgen/contracts";
import type { AgChartInstance } from "ag-charts-community";
import { Download, Link, Pin, PinOff } from "lucide-react";
import { useEffect, useState } from "react";

import type { Pins } from "../pins.ts";
import { chartLink } from "../share.ts";
import { Button } from "./ui/button.tsx";

interface Props {
  chart: Chart;
  /** The drawn chart, once its code has loaded. Until then, there's nothing to download. */
  drawn: AgChartInstance | null;
  pins: Pins;
}

/** Pins the chart to the watchlist, copies a link to it, and downloads it as a PNG. */
export function ChartActions({ chart, drawn, pins }: Props) {
  const pinned = pins.isPinned(chart);
  const [copied, setCopied] = useState<"copied" | "failed">();

  // The note about the copy goes after a moment.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(undefined);
    }, 3000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(await chartLink(chart));
      setCopied("copied");
    } catch {
      // The browser can refuse, as on a page that isn't HTTPS.
      setCopied("failed");
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (pinned) pins.unpin(chart);
          else pins.pin(chart);
        }}
      >
        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {pinned ? "Unpin" : "Pin"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void copyLink();
        }}
      >
        <Link aria-hidden />
        Copy link
      </Button>
      {drawn && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // A failed download leaves nothing to show.
            void drawn
              .download({ fileName: fileName(chart) })
              .catch(() => undefined);
          }}
        >
          <Download aria-hidden />
          Download PNG
        </Button>
      )}
      {/* Always there, so screen readers hear what goes into it. */}
      <p role="status" className="text-sm text-muted-foreground">
        {copied === "copied" && "Link copied."}
        {copied === "failed" && "Couldn't copy the link."}
      </p>
    </>
  );
}

/** A file name from the chart's title, like "errors-for-payments-service-last-7-days.png". */
const fileName = (chart: Chart) =>
  `${
    chart.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "chart"
  }.png`;
