import type { Chart } from "@dashgen/contracts";

const DAY = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const HOUR = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
});
const COMPACT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const FULL = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/**
 * A day, like "Oct 25". Days are UTC midnights, so they're labeled in UTC:
 * in local time, west of UTC, each would show as the day before.
 */
export const formatDay = (date: Date): string => DAY.format(date);

/** An hour, like "Oct 30, 2 PM", in the visitor's time zone. */
export const formatHour = (date: Date): string => HOUR.format(date);

/** An x value, as the tooltip and the data table show it. */
export function formatX(x: string, kind: Chart["x"]): string {
  if (kind === "category") return x;
  const date = new Date(x);
  return kind === "day" ? formatDay(date) : formatHour(date);
}

/** A value with its unit, like "1,284" or "340 ms". Counts have no unit. */
export const formatValue = (value: number, unit: string): string =>
  withUnit(FULL.format(value), unit);

/** An axis tick: compact from 1,000 up, like "1.2K", with its unit. */
export const formatTick = (value: number, unit: string): string =>
  withUnit(COMPACT.format(value), unit);

const withUnit = (number: string, unit: string) =>
  unit === "count" ? number : `${number} ${unit}`;
