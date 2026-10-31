# 9. UUIDv7 for IDs

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Each request gets an ID, to find its log lines, and each question gets a run ID: the primary key of `runs`, and the `runId` the page uses to watch the run. The two are separate because a run outlives the request that starts it: its events reach the page through other requests. The first version used random UUIDs (version 4): `randomUUID()` for requests, and `gen_random_uuid()` as the default for `runs.id`.

A random primary key puts each new row at a random place in the index, so inserts touch pages all over it, and the IDs say nothing about order or time.

The options considered:

- **UUIDv4.** Unique without any coordination, but scattered through the index, and they don't sort.
- **An integer from a sequence** (`bigserial` or an identity column). Small and ordered, but only the database can make one, and the backend needs the ID before the run is saved: `ask` returns it to the page right away. It would also tell anyone how many questions we've had.
- **UUIDv7** (RFC 9562). The first 48 bits are the time in milliseconds, the rest are random. Node 24.16 makes them (`crypto.randomUUIDv7()`), and so does Postgres 18 (`uuidv7()`).
- **UUIDv7 from the `uuid` package.** Strictly increasing even within one millisecond, but a new dependency for what Node now does itself.
- **ULID.** The same idea in its own text format, which needs a package and doesn't fit Postgres's `uuid` type as it is.

## Decision

UUIDv7 everywhere: `randomUUIDv7()` for request IDs, and for run IDs, which the backend makes when each question is asked, with Postgres 18's `uuidv7()` as the `runs.id` default for rows inserted any other way (migration `0001_runs_uuidv7`). Nothing new to install. They're 16 bytes in the same `uuid` column as v4, so the switch needed only a new default.

## Consequences

- New rows go to the end of the primary key's index, which keeps inserts cheap as `runs` grows. At our size the gain is small; it's the default that stays right as tables grow, and it costs nothing.
- IDs sort by time, and each one says when it was made, which helps when reading logs.
- An ID shows when its run started. Run IDs aren't secrets and that time isn't sensitive, so that's fine here. An ID that mustn't reveal its time would use v4.
- Node's IDs are ordered only to the millisecond: two made in the same millisecond can sort either way, and Node's docs say the clock isn't guaranteed to only move forward. `created_at` keeps the exact order.
- It needs Node 24.16 or later (`engines` in `package.json` says so) and Postgres 18, both locally and on RDS in step 5.
