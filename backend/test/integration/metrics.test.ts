import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { MetricsResult } from "@dashgen/contracts";
import { and, eq, gte, lt, max } from "drizzle-orm";

import type { Db } from "../../src/db.ts";
import { createMetrics, MetricsError } from "../../src/metrics/index.ts";
import { points } from "../../src/metrics/schema.ts";
import { seedMetrics } from "../../src/metrics/seed.ts";
import { createTestDb, type TestDb } from "../helpers/db.ts";

// The design's example question is asked at 10:00 UTC.
const NOW = new Date("2026-10-27T10:00:00Z");

let testDb: TestDb;
let db: Db;

before(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  await seedMetrics(db, NOW);
});

after(() => testDb.drop());

const metrics = () => createMetrics(db, { now: () => NOW });

test("seeding again replaces the data instead of adding to it", async () => {
  assert.equal(await seedMetrics(db, NOW), 7_200);
  assert.equal(await db.$count(points), 7_200);

  const [range] = await db
    .select({ last: max(points.recordedAt) })
    .from(points);
  assert.ok(range);
  assert.equal(range.last?.toISOString(), "2026-10-27T10:00:00.000Z");
});

test("listServices lists every service, and each metric's unit and rollup", async () => {
  const catalog = await metrics().listServices();

  assert.equal(catalog.services.length, 5);
  assert.ok(catalog.services.includes("payments-service"));
  assert.deepEqual(catalog.metrics, [
    { name: "errors", unit: "count", rollup: "sum" },
    { name: "latency_ms", unit: "ms", rollup: "avg" },
  ]);
});

test("3 days come in daily buckets, with today marked partial", async () => {
  const result = await metrics().query({
    service: "checkout-api",
    metric: "errors",
    days: 3,
  });

  MetricsResult.parse(result);
  assert.equal(result.bucket, "day");
  assert.deepEqual(
    result.points.map((p) => [p.t, p.partial ?? false]),
    [
      ["2026-10-25T00:00:00.000Z", false],
      ["2026-10-26T00:00:00.000Z", false],
      ["2026-10-27T00:00:00.000Z", true],
    ],
  );
  const sum = result.points.reduce((total, p) => total + p.value, 0);
  assert.equal(result.summary.total, sum);
});

test("up to 2 days come in hourly buckets", async () => {
  const result = await metrics().query({
    service: "auth-service",
    metric: "errors",
    days: 2,
  });

  assert.equal(result.bucket, "hour");
  assert.equal(result.points.length, 48);
  assert.equal(result.points.at(-1)?.t, "2026-10-27T10:00:00.000Z");
  assert.ok(result.points.every((p) => p.partial === undefined));
});

test("latency averages across a day, and has no total", async () => {
  const result = await metrics().query({
    service: "search-service",
    metric: "latency_ms",
    days: 3,
  });

  const hours = await db
    .select({ value: points.value })
    .from(points)
    .where(
      and(
        eq(points.service, "search-service"),
        eq(points.metric, "latency_ms"),
        gte(points.recordedAt, new Date("2026-10-26T00:00:00Z")),
        lt(points.recordedAt, new Date("2026-10-27T00:00:00Z")),
      ),
    );
  const average = hours.reduce((total, h) => total + h.value, 0) / hours.length;

  assert.equal(result.points[1]?.value, Math.round(average * 100) / 100);
  assert.equal(result.summary.total, undefined);
});

test("the payments-service error spike two days ago stands out", async () => {
  const result = await metrics().query({
    service: "payments-service",
    metric: "errors",
    days: 3,
  });
  const [spikeDay, ...laterDays] = result.points;

  assert.ok(spikeDay && laterDays.every((day) => day.value < spikeDay.value));
  assert.ok(result.summary.max > 4 * result.summary.avg);
});

test("unknown names are rejected, listing the known ones", async () => {
  await assert.rejects(
    metrics().query({ service: "billing", metric: "errors" }),
    (error: unknown) =>
      error instanceof MetricsError &&
      error.message.includes("payments-service"),
  );
  await assert.rejects(
    metrics().query({ service: "auth-service", metric: "cpu" }),
    MetricsError,
  );
});

test("days run from 1 to 30", async () => {
  await assert.rejects(
    metrics().query({ service: "auth-service", metric: "errors", days: 31 }),
  );
});

// Last, because it deletes data the other tests use.
test("missing hours are logged as a warning", async () => {
  const warnings: object[] = [];
  const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: (obj: object) => warnings.push(obj),
    error: () => undefined,
  };
  await db
    .delete(points)
    .where(
      and(
        eq(points.service, "notifications-worker"),
        eq(points.metric, "latency_ms"),
        gte(points.recordedAt, new Date("2026-10-26T00:00:00Z")),
        lt(points.recordedAt, new Date("2026-10-26T06:00:00Z")),
      ),
    );

  await createMetrics(db, { now: () => NOW, log }).query({
    service: "notifications-worker",
    metric: "latency_ms",
    days: 3,
  });

  // Oct 25 00:00 to Oct 27 10:00 is 59 hours, and 6 are gone.
  assert.deepEqual(warnings, [
    {
      service: "notifications-worker",
      metric: "latency_ms",
      days: 3,
      bucket: "day",
      expectedHours: 59,
      foundHours: 53,
    },
  ]);
});
