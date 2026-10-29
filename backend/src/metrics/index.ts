import {
  MetricsQuery,
  type MetricsResult,
  type ServiceCatalog,
} from "@dashgen/contracts";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import type { Db } from "../db.ts";
import { consoleLogger, type Logger } from "../logger.ts";
import { metrics, points, services } from "./schema.ts";
import { DAY_MS, HOUR_MS, startOfDay, startOfHour } from "./time.ts";

/** A query the caller got wrong, like an unknown service. Its message is meant for the model. */
export class MetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricsError";
  }
}

/** The metrics module: read-only access to the sample time series. */
export interface Metrics {
  listServices(): Promise<ServiceCatalog>;
  query(input: MetricsQuery): Promise<MetricsResult>;
}

const round = (value: number) => Math.round(value * 100) / 100;

export interface MetricsOptions {
  /** The clock, so tests can fix it. */
  now?: () => Date;
  log?: Logger;
}

export function createMetrics(
  db: Db,
  { now = () => new Date(), log = consoleLogger }: MetricsOptions = {},
): Metrics {
  async function listServices(): Promise<ServiceCatalog> {
    const [serviceRows, metricRows] = await Promise.all([
      db.select().from(services).orderBy(asc(services.name)),
      db.select().from(metrics).orderBy(asc(metrics.name)),
    ]);
    return { services: serviceRows.map((s) => s.name), metrics: metricRows };
  }

  async function query(input: MetricsQuery): Promise<MetricsResult> {
    const parsed = MetricsQuery.parse(input);
    const { service, metric, days } = parsed;
    const bucket = parsed.bucket ?? (days <= 2 ? "hour" : "day");

    const catalog = await listServices();
    const info = catalog.metrics.find((m) => m.name === metric);
    if (!catalog.services.includes(service)) {
      throw new MetricsError(
        `Unknown service "${service}". Known services: ${catalog.services.join(", ")}.`,
      );
    }
    if (!info) {
      throw new MetricsError(
        `Unknown metric "${metric}". Known metrics: ${catalog.metrics.map((m) => m.name).join(", ")}.`,
      );
    }

    // Daily buckets are whole UTC days ending with today so far; hourly ones end with this hour.
    const time = now().getTime();
    const lastHour = startOfHour(time);
    const today = startOfDay(time);
    const from =
      bucket === "day"
        ? today - (days - 1) * DAY_MS
        : lastHour - (days * 24 - 1) * HOUR_MS;

    // Constants only: no input ever reaches sql.raw.
    const unit = sql.raw(bucket === "day" ? "'day'" : "'hour'");
    const t = sql`date_trunc(${unit}, ${points.recordedAt}, 'UTC')`.mapWith(
      // Drizzle returns timestamps from raw SQL as text. The summary row's is null.
      (value: string | null) => (value === null ? null : new Date(value)),
    );
    const started = performance.now();
    const rows = await db
      .select({
        t,
        hours: sql<number>`count(*)`.mapWith(Number),
        value:
          info.rollup === "sum"
            ? sql<number>`sum(${points.value})`
            : sql<number>`avg(${points.value})`,
        total: sql<number | null>`sum(${points.value})`,
        avg: sql<number | null>`avg(${points.value})`,
        min: sql<number | null>`min(${points.value})`,
        max: sql<number | null>`max(${points.value})`,
        latest: sql<
          number | null
        >`(array_agg(${points.value} order by ${points.recordedAt} desc))[1]`,
      })
      .from(points)
      .where(
        and(
          eq(points.metric, metric),
          eq(points.service, service),
          gte(points.recordedAt, new Date(from)),
          lte(points.recordedAt, new Date(lastHour)),
        ),
      )
      // One row per bucket, plus one row over all the hours (t is null): the summary.
      .groupBy(sql`grouping sets ((${t}), ())`)
      .orderBy(asc(t));

    const buckets = rows.filter(
      (row): row is (typeof rows)[number] & { t: Date } => row.t !== null,
    );
    const summary = rows.find((row) => row.t === null);
    if (
      buckets.length === 0 ||
      summary?.total == null ||
      summary.avg == null ||
      summary.min == null ||
      summary.max == null ||
      summary.latest == null
    ) {
      throw new MetricsError(
        `No data for ${service} ${metric} in the last ${String(days)} days.`,
      );
    }

    const context = { service, metric, days, bucket };
    // Missing hours mean a chart with silent holes, or a seed that's gone stale.
    const expectedHours = (lastHour - from) / HOUR_MS + 1;
    if (summary.hours < expectedHours) {
      log.warn(
        { ...context, expectedHours, foundHours: summary.hours },
        "metrics data has missing hours",
      );
    }
    log.debug(
      {
        ...context,
        points: buckets.length,
        ms: Math.round(performance.now() - started),
      },
      "metrics query",
    );

    return {
      service,
      metric,
      unit: info.unit,
      bucket,
      points: buckets.map((row) => ({
        t: row.t.toISOString(),
        value: round(row.value),
        // Today's daily bucket is still growing, so the chart draws it lighter.
        ...(bucket === "day" && row.t.getTime() === today
          ? { partial: true as const }
          : {}),
      })),
      summary: {
        // A total of latencies means nothing, so only metrics that add up get one.
        ...(info.rollup === "sum" ? { total: round(summary.total) } : {}),
        avg: round(summary.avg),
        min: round(summary.min),
        max: round(summary.max),
        latest: round(summary.latest),
      },
    };
  }

  return { listServices, query };
}
