import { CircleAlert, X } from "lucide-react";
import { useId, useState } from "react";

import { headline } from "../chart/summary.ts";
import type { Pin } from "../pins.ts";
import { preloadChart } from "./answer.tsx";
import { Sparkline } from "./sparkline.tsx";
import { Button } from "./ui/button.tsx";

interface Props {
  pins: Pin[];
  onOpen: (pin: Pin) => void;
  onUnpin: (pin: Pin) => void;
  /** A question is on its way, so a pin can't take its place yet. */
  busy: boolean;
  /** The browser kept the pins. When it won't, as with storage blocked or full, they last only until the page closes. */
  stored: boolean;
}

/** The charts pinned in this browser, each with its number, to open again with no run. */
export function Watchlist({ pins, onOpen, onUnpin, busy, stored }: Props) {
  if (pins.length === 0) return null;
  return (
    // A section of its own, so a little more room above it.
    <section aria-labelledby="watchlist" className="space-y-3 pt-6">
      <div className="space-y-1">
        <h2 id="watchlist" className="text-lg font-semibold tracking-tight">
          Your watchlist
        </h2>
        {stored ? (
          <p className="text-sm text-muted-foreground">
            Saved in this browser only. Each chart keeps the numbers it had when
            you pinned it.
          </p>
        ) : (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            Your browser isn't saving pins, so these last only until you leave
            the page.
          </p>
        )}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pins.map((pin) => (
          <PinCard
            key={pin.pinnedAt}
            pin={pin}
            onOpen={onOpen}
            onUnpin={onUnpin}
            busy={busy}
          />
        ))}
      </ul>
    </section>
  );
}

function PinCard({
  pin,
  onOpen,
  onUnpin,
  busy,
}: { pin: Pin } & Omit<Props, "pins" | "stored">) {
  const { value, label, series } = headline(pin.chart);
  const numberId = useId();
  // Each time the pointer comes onto the card, its mini chart draws again.
  const [hovers, setHovers] = useState(0);
  return (
    <li className="relative rounded-xl border bg-card text-card-foreground shadow-sm">
      {/* Named for what it does and the chart it opens. Screen readers
          hear the number after, as its description. */}
      <button
        type="button"
        aria-label={`Open ${pin.chart.title}`}
        aria-describedby={numberId}
        disabled={busy}
        onClick={() => {
          onOpen(pin);
        }}
        // The chart's code starts loading before the click, so the chart
        // can usually draw at once.
        onPointerEnter={() => {
          preloadChart();
          setHovers((count) => count + 1);
        }}
        onFocus={() => {
          preloadChart();
        }}
        className="block w-full rounded-xl p-4 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        {/* Room on the right for the unpin button, which sits over the
            card's corner. Only the title needs it. */}
        <span className="line-clamp-2 pr-8 text-sm font-medium">
          {pin.chart.title}
        </span>
        <span className="mt-2 flex items-end justify-between gap-3">
          <span id={numberId} className="min-w-0">
            <span className="block text-xl font-semibold tracking-tight">
              {value}
            </span>{" "}
            <span className="block text-xs text-muted-foreground">{label}</span>
          </span>
          <Sparkline chart={pin.chart} series={series} drawing={hovers} />
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-8 text-muted-foreground"
        aria-label={`Unpin ${pin.chart.title}`}
        onClick={() => {
          onUnpin(pin);
        }}
      >
        <X aria-hidden />
      </Button>
    </li>
  );
}
