// Hours and days in UTC, shared by the seed and the queries, so the data and
// its buckets always agree on where an hour or a day starts.

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** The start of the UTC hour that `time` (in milliseconds) falls in. */
export const startOfHour = (time: number) =>
  Math.floor(time / HOUR_MS) * HOUR_MS;

/** The start of the UTC day that `time` (in milliseconds) falls in. */
export const startOfDay = (time: number) => Math.floor(time / DAY_MS) * DAY_MS;
