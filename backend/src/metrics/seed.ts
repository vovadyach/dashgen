import type { Db } from "../db.ts";
import { metrics, points, services } from "./schema.ts";

import { DAY_MS, HOUR_MS, startOfDay, startOfHour } from "./time.ts";
const SEED_DAYS = 30;

/** The sample services, with each one's typical errors per hour and latency. */
const SERVICES = [
  { name: "auth-service", errorsPerHour: 1, latencyMs: 80 },
  { name: "payments-service", errorsPerHour: 1.5, latencyMs: 230 },
  { name: "checkout-api", errorsPerHour: 2, latencyMs: 420 },
  { name: "search-service", errorsPerHour: 0.8, latencyMs: 280 },
  { name: "notifications-worker", errorsPerHour: 0.5, latencyMs: 150 },
] as const;

const METRICS = [
  { name: "errors", unit: "count", rollup: "sum" },
  { name: "latency_ms", unit: "ms", rollup: "avg" },
] as const;

type Service = (typeof SERVICES)[number];
type MetricName = (typeof METRICS)[number]["name"];

/** A number in [0, 1) that depends only on `key`: FNV-1a, then mulberry32. */
function random(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  }
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Busiest in the UTC afternoon, quieter at weekends. */
function traffic(hour: Date): number {
  const daily =
    1 + 0.5 * Math.sin(((hour.getUTCHours() - 9) / 24) * 2 * Math.PI);
  const day = hour.getUTCDay();
  return day === 0 || day === 6 ? daily * 0.7 : daily;
}

/** Incidents, counted back from the seed's day, so "this week" always finds them. */
function incident(
  service: string,
  metric: MetricName,
  hour: Date,
  today: number,
): number {
  const daysAgo = Math.round((today - startOfDay(hour.getTime())) / DAY_MS);
  const h = hour.getUTCHours();
  if (
    service === "payments-service" &&
    metric === "errors" &&
    daysAgo === 2 &&
    h >= 14 &&
    h < 17
  ) {
    return 10;
  }
  if (
    service === "checkout-api" &&
    metric === "latency_ms" &&
    daysAgo === 4 &&
    h >= 9 &&
    h < 11
  ) {
    return 2.5;
  }
  return 1;
}

function valueFor(
  service: Service,
  metric: MetricName,
  hour: Date,
  today: number,
): number {
  // The noise depends only on the service, metric and hour, so an hour's value
  // is the same whichever day the seed runs. Only the incidents move.
  const noise = random(`${service.name}:${metric}:${hour.toISOString()}`);
  const spike = incident(service.name, metric, hour, today);
  if (metric === "errors") {
    return Math.round(
      service.errorsPerHour * traffic(hour) * (0.5 + noise) * spike,
    );
  }
  const load = 0.9 + 0.1 * traffic(hour);
  return Math.round(service.latencyMs * load * (0.85 + 0.3 * noise) * spike);
}

/** 30 days of hourly points for every service and metric, ending with the hour of `now`. */
export function generatePoints(now: Date) {
  const lastHour = startOfHour(now.getTime());
  const today = startOfDay(now.getTime());
  const rows: (typeof points.$inferInsert)[] = [];
  for (let i = SEED_DAYS * 24 - 1; i >= 0; i--) {
    const hour = new Date(lastHour - i * HOUR_MS);
    for (const service of SERVICES) {
      for (const { name: metric } of METRICS) {
        const value = valueFor(service, metric, hour, today);
        rows.push({ metric, service: service.name, recordedAt: hour, value });
      }
    }
  }
  return rows;
}

/** Replaces all sample data in one transaction, so a failure leaves the old data intact. */
export async function seedMetrics(db: Db, now: Date): Promise<number> {
  const rows = generatePoints(now);
  await db.transaction(async (tx) => {
    await tx.delete(points);
    await tx.delete(services);
    await tx.delete(metrics);
    await tx.insert(services).values(SERVICES.map(({ name }) => ({ name })));
    await tx.insert(metrics).values([...METRICS]);
    // Batches stay far below Postgres's limit of 65,535 parameters a statement.
    for (let i = 0; i < rows.length; i += 1_000) {
      await tx.insert(points).values(rows.slice(i, i + 1_000));
    }
  });
  return rows.length;
}
