import type { Chart } from "@dashgen/contracts";

import { xValuesOf } from "./format.ts";

const X_COLUMNS = { day: "day (UTC)", hour: "hour (UTC)", category: "service" };

/**
 * The chart's numbers as CSV, for a spreadsheet: a row per x value
 * and a column per series, with a last `partial` column when some days or
 * hours have under a whole one's data. Days are dates and hours ISO times,
 * both in UTC, which spreadsheets read as they are.
 */
export function chartCsv(chart: Chart): string {
  const partial = chart.series.some((s) => s.points.some((p) => p.partial));
  const columns = chart.series.map(
    (series) => new Map(series.points.map((point) => [point.x, point])),
  );
  const header = [
    X_COLUMNS[chart.x],
    ...chart.series.map((series) => series.name),
    ...(partial ? ["partial"] : []),
  ];
  const rows = xValuesOf(chart).map((x) => {
    const points = columns.map((column) => column.get(x));
    return [
      chart.x === "day" ? x.slice(0, 10) : x,
      ...points.map((point) => (point ? String(point.y) : "")),
      ...(partial ? [points.some((point) => point?.partial) ? "yes" : ""] : []),
    ];
  });
  return [header, ...rows].map((row) => row.map(field).join(",")).join("\r\n");
}

/**
 * One CSV field: quoted when it has a comma, a quote or a line break. Text a
 * spreadsheet could run as a formula gets a leading ', since a link anyone
 * wrote can carry any names: text starting with a tab or a line break,
 * OWASP's list, or with = + - @ after any spaces, which some spreadsheets
 * drop before reading the rest.
 */
function field(text: string): string {
  const isNumber = text !== "" && !Number.isNaN(Number(text));
  const formula = /^[\t\r\n]|^\s*[=+\-@]/.test(text);
  const safe = !isNumber && formula ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
