import type { Chart } from "@dashgen/contracts";
import {
  type AgChartInstance,
  AreaSeriesModule,
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
import { type Ref, useCallback, useMemo, useState } from "react";

import { chartOptions } from "../chart/options.ts";
import { useTheme } from "../theme.tsx";

// Only the parts DashGen draws, so the rest of AG Charts stays out of the download.
ModuleRegistry.registerModules([
  LineSeriesModule,
  // A line alone is drawn as an area, for the wash under it.
  AreaSeriesModule,
  BarSeriesModule,
  PieSeriesModule,
  CategoryAxisModule,
  NumberAxisModule,
  TimeAxisModule,
  LegendModule,
]);

interface Props {
  chart: Chart;
  /** Gets the drawn chart, which can download itself as a PNG. */
  ref?: Ref<AgChartInstance>;
}

/**
 * Draws a chart with AG Charts, on a canvas. It's most of the page's code, so
 * it loads on its own, while the agent works on the first question.
 */
export default function ChartView({ chart, ref }: Props) {
  const { theme } = useTheme();
  const [width, setWidth] = useState<number>();
  // The chart's width decides how many day labels fit, how wide bars are and
  // whether dots fit, and a phone turned sideways changes it. It's kept in
  // steps of 20 px, so resizing redraws the chart only when that matters.
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width / 20) * 20);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const options = useMemo(
    () => chartOptions(chart, theme, width),
    [chart, theme, width],
  );
  return (
    <div ref={measure}>
      <AgCharts ref={ref} options={options} className="h-72 w-full sm:h-96" />
    </div>
  );
}
