import type { Chart } from "@dashgen/contracts";

import { formatValue, xValuesOf } from "../chart/format.ts";
import { PALETTE, seriesColor } from "../chart/palette.ts";
import { type ServiceRow, serviceRows } from "../chart/summary.ts";
import { useTheme } from "../theme.tsx";
import { Sparkline } from "./sparkline.tsx";

// Days are UTC midnights, so they're dated in UTC, and hours in the
// visitor's time zone, as everywhere on the page.
const DAYS = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const HOURS = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/**
 * The dates a chart's trends span, like "Oct 25 – 31", from its first and
 * last points, since a series can skip some. Dates, not "Last 7 days": a
 * pinned chart keeps its numbers, so its days stop being the last ones.
 */
function rangeOf(chart: Chart): string {
  const xs = xValuesOf(chart);
  const first = xs[0];
  const last = xs.at(-1);
  if (first === undefined || last === undefined) return "";
  const dates = chart.x === "hour" ? HOURS : DAYS;
  return dates.formatRange(new Date(first), new Date(last));
}

/**
 * What the values column holds. Over time, the page sums each series up
 * itself. Side by side, the backend picked a total, an average, a highest,
 * lowest or last hour, and named the series after it, like "errors, highest
 * hour", so the column takes that name. With more series than one to name
 * it, it's just the value.
 */
function valuesHeading(chart: Chart, overTime: boolean): string {
  if (overTime) return chart.unit === "count" ? "Total" : "Average";
  const [only, ...more] = chart.series;
  return only && more.length === 0 ? only.name : "Value";
}

/**
 * The data table's view by service: a row per service, with its trend, or a
 * bar when services sit side by side, and the numbers that sum it up. Each
 * service keeps its color from the chart.
 */
export function ServiceTable({ chart }: { chart: Chart }) {
  const { theme } = useTheme();
  const colors = PALETTE[theme];
  const rows = serviceRows(chart);
  const overTime = chart.type !== "pie" && chart.x !== "category";
  const shares = rows.some((row) => row.share !== undefined);
  // A key only when the colors tell services apart: bars share one color.
  const keyed = rows.length > 1 && (overTime || chart.type === "pie");
  const head = "py-1.5 pl-4 text-right font-medium";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">By service</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-1.5 pr-4 text-left font-medium">
              Service
            </th>
            {overTime && (
              <th scope="col" className="px-4 py-1.5 text-left font-medium">
                {rangeOf(chart)}
              </th>
            )}
            <th scope="col" className={head}>
              {valuesHeading(chart, overTime)}
            </th>
            {overTime && (
              <>
                <th scope="col" className={head}>
                  Peak
                </th>
                <th scope="col" className={head}>
                  Latest
                </th>
              </>
            )}
            {shares && (
              <th scope="col" className={head}>
                Share
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Row
              // A chart could name two series alike, so the name isn't a key.
              key={index}
              row={row}
              chart={chart}
              color={seriesColor(colors, row.color)}
              keyed={keyed}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  chart,
  color,
  keyed,
}: {
  row: ServiceRow;
  chart: Chart;
  color: string;
  keyed: boolean;
}) {
  const first = row.series?.points[0];
  const last = row.series?.points.at(-1);
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-1.5 pr-4 text-left font-normal">
        <span className="flex items-center gap-2">
          {keyed && (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: color }}
            />
          )}
          {row.name}
        </span>
      </th>
      {row.series && (
        <td className="px-4 py-1">
          <Sparkline chart={chart} series={row.series} dot={color} />
          {/* The line is hidden from screen readers, so they hear where it went. */}
          {first && last && (
            <span className="sr-only">
              {formatValue(first.y, chart.unit)} to{" "}
              {formatValue(last.y, chart.unit)}
            </span>
          )}
        </td>
      )}
      <td className="py-1.5 pl-4 text-right">
        {row.size === undefined ? (
          row.value
        ) : (
          <span className="flex items-center justify-end gap-3">
            <span
              aria-hidden
              className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(row.size * 100).toFixed(1)}%`,
                  background: color,
                }}
              />
            </span>
            {row.value}
          </span>
        )}
      </td>
      {row.peak && <When {...row.peak} />}
      {row.latest && <When {...row.latest} />}
      {row.share !== undefined && (
        <td className="py-1.5 pl-4 text-right">{row.share}</td>
      )}
    </tr>
  );
}

/** A value, with when it was on a quieter line under it. */
function When({ value, when }: { value: string; when: string }) {
  return (
    <td className="py-1.5 pl-4 text-right">
      {value}
      {/* Heard as "94, Oct 29": the comma isn't needed on screen. */}
      <span className="sr-only">, </span>
      <span className="block text-xs whitespace-nowrap text-muted-foreground">
        {when}
      </span>
    </td>
  );
}
