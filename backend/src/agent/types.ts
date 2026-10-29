import { Chart, ChartType } from "@dashgen/contracts";
import { z } from "zod";

/** The summary statistic that turns each service's series into one number, to compare services. */
export const Aggregation = z.enum(["avg", "max", "min", "total", "latest"]);
export type Aggregation = z.infer<typeof Aggregation>;

/** create_chart's arguments. The model names query results; it never sends numbers. */
export const CreateChartArgs = z.object({
  type: ChartType,
  sources: z.array(z.string()).min(1).max(10),
  title: Chart.shape.title,
  aggregation: Aggregation.optional(),
});
export type CreateChartArgs = z.infer<typeof CreateChartArgs>;
