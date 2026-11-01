import type { Chart } from "@dashgen/contracts";
import {
  BarSeriesModule,
  CategoryAxisModule,
  LegendModule,
  LineSeriesModule,
  ModuleRegistry,
  NumberAxisModule,
  PieSeriesModule,
  TimeAxisModule,
} from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useCallback, useMemo, useState } from "react";

import { chartOptions, dayLabelsFor } from "../chart/options.ts";
import { useTheme } from "../theme.tsx";

// Only the parts DashGen draws, so the rest of AG Charts stays out of the download.
ModuleRegistry.registerModules([
  LineSeriesModule,
  BarSeriesModule,
  PieSeriesModule,
  CategoryAxisModule,
  NumberAxisModule,
  TimeAxisModule,
  LegendModule,
]);

/**
 * Draws a chart with AG Charts, on a canvas. It's most of the page's code, so
 * it loads on its own, while the agent works on the first question.
 */
export default function ChartView({ chart }: { chart: Chart }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState<number>();
  // The chart's width decides how many day labels fit, and a phone turned
  // sideways changes it.
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const dayLabels = width === undefined ? undefined : dayLabelsFor(width);
  const options = useMemo(
    () => chartOptions(chart, theme, dayLabels),
    [chart, theme, dayLabels],
  );
  return (
    <div ref={measure}>
      <AgCharts options={options} className="h-72 w-full sm:h-80" />
    </div>
  );
}
