import { Chart } from "@dashgen/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

/** A chart pinned in this browser, with its numbers, so it draws without the backend. */
export interface Pin {
  chart: Chart;
  /** When it was pinned, as an ISO time: its numbers are from then. */
  pinnedAt: string;
  /**
   * It was opened from a share link, so its numbers are the link's, which
   * anyone can write, not DashGen's. The page keeps saying so (ADR-0013).
   */
  fromLink?: true;
}

/** The `localStorage` key the pins live under. */
export const PINS_KEY = "pins";

/**
 * The pins saved in this browser, newest first. An entry the page can't
 * read, from an older version of it or edited by hand, is left out, so it
 * can't break the page. Blocked storage reads as no pins.
 */
export function loadPins(): Pin[] {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  return (saved as unknown[]).flatMap((entry) => {
    const pin = readPin(entry);
    return pin ? [pin] : [];
  });
}

function readPin(entry: unknown): Pin | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { chart, pinnedAt, fromLink } = entry as Record<string, unknown>;
  const parsed = Chart.safeParse(chart);
  if (!parsed.success || typeof pinnedAt !== "string") return undefined;
  if (Number.isNaN(Date.parse(pinnedAt))) return undefined;
  // Pinned before pins kept this, a chart counts as one of DashGen's.
  return {
    chart: parsed.data,
    pinnedAt,
    ...(fromLink === true && { fromLink }),
  };
}

/** Saves the pins, and says whether the browser kept them. */
function savePins(pins: Pin[]): boolean {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
    return true;
  } catch {
    // Storage is blocked or full, so the pins last until the page reloads.
    return false;
  }
}

/**
 * The same chart, with the same numbers. Every chart the page has was parsed
 * with the `Chart` schema, which lists its keys in one order.
 */
const sameChart = (a: Chart, b: Chart) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The watchlist: charts pinned in this browser, newest first. */
export function usePins() {
  const [pins, setPins] = useState(loadPins);
  // Whether the browser kept the last change, so the page can say when the
  // pins won't outlast it.
  const [stored, setStored] = useState(true);

  // Pins changed in another tab. The storage event fires only in the others.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PINS_KEY || event.key === null) setPins(loadPins());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const change = (next: Pin[]) => {
    setPins(next);
    setStored(savePins(next));
  };
  const others = (chart: Chart) =>
    pins.filter((pin) => !sameChart(pin.chart, chart));
  // Each pin's chart as text, made once each time the pins change, not
  // again for each chart on the page each time it redraws.
  const pinned = useMemo(
    () => new Set(pins.map((pin) => JSON.stringify(pin.chart))),
    [pins],
  );
  const isPinned = useCallback(
    (chart: Chart) => pinned.has(JSON.stringify(chart)),
    [pinned],
  );

  return {
    pins,
    stored,
    isPinned,
    pin: (chart: Chart, fromLink = false) => {
      const pinnedAt = new Date().toISOString();
      change([
        { chart, pinnedAt, ...(fromLink && { fromLink: true as const }) },
        ...others(chart),
      ]);
    },
    unpin: (chart: Chart) => {
      change(others(chart));
    },
  };
}

export type Pins = ReturnType<typeof usePins>;
