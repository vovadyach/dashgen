import assert from "node:assert/strict";
import { test } from "node:test";

import { startOfDay, startOfHour } from "../../../src/metrics/time.ts";

// Times go in as milliseconds and come back out as ISO strings, so each case reads as dates.
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

test("startOfHour rounds down to the start of the UTC hour", () => {
  const cases = [
    ["2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z"], // exactly on the hour
    ["2026-10-27T10:30:15.000Z", "2026-10-27T10:00:00.000Z"], // mid-hour
    ["2026-10-27T10:59:59.999Z", "2026-10-27T10:00:00.000Z"], // the hour's last millisecond
    ["2026-10-27T23:45:00.000Z", "2026-10-27T23:00:00.000Z"], // the day's last hour
  ];
  for (const [input = "", expected] of cases) {
    assert.equal(iso(startOfHour(at(input))), expected, input);
  }
});

test("startOfDay rounds down to midnight UTC", () => {
  const cases = [
    ["2026-10-27T00:00:00.000Z", "2026-10-27T00:00:00.000Z"], // exactly midnight
    ["2026-10-27T10:00:00.000Z", "2026-10-27T00:00:00.000Z"], // mid-day
    ["2026-10-27T23:59:59.999Z", "2026-10-27T00:00:00.000Z"], // the day's last millisecond
    ["2026-12-31T23:30:00.000Z", "2026-12-31T00:00:00.000Z"], // the year's last day
  ];
  for (const [input = "", expected] of cases) {
    assert.equal(iso(startOfDay(at(input))), expected, input);
  }
});

test("days are always 24 hours, even when clocks change", () => {
  // Europe and the US change their clocks on these dates. UTC never does,
  // so the visitor's time zone can't make a day 23 or 25 hours long.
  for (const date of ["2026-03-29", "2026-10-25", "2026-11-01"]) {
    const day = startOfDay(at(`${date}T12:00:00Z`));
    const next = startOfDay(at(`${date}T12:00:00Z`) + 24 * 3_600_000);
    assert.equal(next - day, 24 * 3_600_000, date);
  }
});

test("an hour always falls inside its day", () => {
  const time = at("2026-10-27T17:42:00Z");
  assert.ok(startOfDay(time) <= startOfHour(time));
  assert.ok(startOfHour(time) <= time);
});
