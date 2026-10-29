# 8. Postgres for the metrics and the runs

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The backend stores two things: an hourly time series (5 services × 2 metrics × 30 days = 7,200 rows) and a log of questions (`runs`, a few KB each). The agent's questions aren't known in advance: "errors this week", "slowest service", "latency by day".

The options considered:

- **Postgres.** SQL answers new questions with filters, ranges, `GROUP BY` and `date_trunc`, without redesigning anything. It runs the same in Docker, in CI and on RDS.
- **DynamoDB.** Cheap and serverless, but every query must be designed up front, and it can't group or aggregate.
- **MongoDB.** Suits documents whose shape varies. This data's shape is fixed.
- **A time-series database** (TimescaleDB, ClickHouse). Built for millions of points a day, which 7,200 rows don't need.

## Decision

Postgres: one `dashgen` database on one small instance, through [Drizzle](0006-drizzle.md). The daily cap is the one exception: its count must outlive each session's database, so it lives in DynamoDB.

## Consequences

- The smallest RDS instance (db.t4g.micro) is plenty; a whole query runs in under a millisecond.
- Tests run against a real Postgres, not a fake, so they catch SQL mistakes.
- **At scale:** with millions of points a day, the time series would move to TimescaleDB or ClickHouse, and the `metrics` module could become its own service with its own database ([ADR-0005](0005-one-backend.md)). The `runs` table would stay in Postgres.
