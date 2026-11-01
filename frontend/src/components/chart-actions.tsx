import type { Chart } from "@dashgen/contracts";
import type { AgChartInstance } from "ag-charts-community";
import { Download, FileSpreadsheet, Link, Pin, PinOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { chartCsv } from "../chart/csv.ts";
import type { Pins } from "../pins.ts";
import { chartLink } from "../share.ts";
import { Button } from "./ui/button.tsx";

interface Props {
  chart: Chart;
  /** The drawn chart, once its code has loaded. Until then, there's nothing to download. */
  drawn: AgChartInstance | null;
  pins: Pins;
  /** The chart came from a share link, which a pin of it keeps saying. */
  fromLink: boolean;
}

/** What the line under the buttons says, after a click on Copy link. */
const NOTES = {
  copied: "Link copied.",
  "not copied": "Couldn't copy the link.",
  "too large": "This chart is too large to share as a link.",
  "not made": "Couldn't make a link to this chart.",
};
type Note = keyof typeof NOTES;

/** Pins the chart to the watchlist, copies a link to it, and downloads it as a PNG. */
export function ChartActions({ chart, drawn, pins, fromLink }: Props) {
  const { isPinned } = pins;
  const pinned = useMemo(() => isPinned(chart), [isPinned, chart]);
  const [note, setNote] = useState<Note>();

  // The link is made as soon as the chart shows, so a click copies it at
  // once: Safari, like every browser on iOS, lets a page copy only while it
  // still handles the click, and making the link takes a moment. A chart too
  // large for a link gets none, and so does a browser that can't compress:
  // the click then says which.
  const [link, setLink] = useState<
    { chart: Chart; url: string } | { chart: Chart; note: Note }
  >();
  useEffect(() => {
    let current = true;
    chartLink(chart).then(
      (url) => {
        if (current) {
          setLink(url ? { chart, url } : { chart, note: "too large" });
        }
      },
      () => {
        if (current) setLink({ chart, note: "not made" });
      },
    );
    return () => {
      current = false;
    };
  }, [chart]);
  // Worked out for this chart, whether or not that gave a link.
  const made = link?.chart === chart ? link : undefined;

  // The note goes after a moment.
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      setNote(undefined);
    }, 3000);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);

  const copyLink = (url: string) => {
    try {
      navigator.clipboard.writeText(url).then(
        () => {
          setNote("copied");
        },
        () => {
          setNote("not copied");
        },
      );
    } catch {
      // A page that isn't HTTPS has no clipboard at all.
      setNote("not copied");
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (pinned) pins.unpin(chart);
          else pins.pin(chart, fromLink);
        }}
      >
        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {pinned ? "Unpin" : "Pin"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!made}
        onClick={() => {
          if (!made) return;
          if ("url" in made) copyLink(made.url);
          else setNote(made.note);
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
              .download({ fileName: fileName(chart, "png") })
              .catch(() => undefined);
          }}
        >
          <Download aria-hidden />
          Download PNG
        </Button>
      )}
      {/* The numbers need no drawn chart, so this one is always there. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          downloadCsv(chart);
        }}
      >
        <FileSpreadsheet aria-hidden />
        Download CSV
      </Button>
      {/* Always there, so screen readers hear what goes into it. */}
      <p role="status" className="text-sm text-muted-foreground">
        {note && NOTES[note]}
      </p>
    </>
  );
}

/** A file name from the chart's title, like "errors-for-payments-service-last-7-days.png". */
const fileName = (chart: Chart, extension: string) =>
  `${
    chart.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "chart"
  }.${extension}`;

/** Saves the chart's numbers as a CSV file, named after its title. */
function downloadCsv(chart: Chart) {
  // A byte order mark first, or Excel reads the file in an older encoding.
  const file = new Blob(["﻿", chartCsv(chart)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(chart, "csv");
  // Firefox follows a link's click only when the link is in the page.
  document.body.append(link);
  link.click();
  link.remove();
  // Later, since some browsers still read the file just after the click.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
