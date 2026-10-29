import assert from "node:assert/strict";
import { test } from "node:test";

import { generatePoints } from "../../../src/metrics/seed.ts";

const NOW = new Date("2026-10-27T10:00:00Z");

test("30 days of hourly points for every service and metric, ending this hour", () => {
  const points = generatePoints(NOW);
  const times = points.map((p) => p.recordedAt.getTime());

  assert.equal(points.length, 5 * 2 * 30 * 24);
  assert.equal(
    new Date(Math.min(...times)).toISOString(),
    "2026-09-27T11:00:00.000Z",
  );
  assert.equal(
    new Date(Math.max(...times)).toISOString(),
    "2026-10-27T10:00:00.000Z",
  );
});

test("an hour's value is the same whichever day the seed runs", () => {
  const hour = "2026-10-20T08:00:00.000Z";
  const valueAt = (now: Date) =>
    generatePoints(now)
      .filter((p) => p.service === "auth-service" && p.metric === "errors")
      .find((p) => p.recordedAt.toISOString() === hour)?.value;

  assert.equal(valueAt(NOW), valueAt(new Date("2026-10-28T15:00:00Z")));
});

test("errors are whole counts, and latency is never negative", () => {
  for (const p of generatePoints(NOW)) {
    if (p.metric === "errors") assert.ok(Number.isInteger(p.value));
    assert.ok(p.value >= 0);
  }
});
