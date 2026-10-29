# 6. Drizzle for data access

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The backend needs typed access to Postgres for the metrics tables and the `runs` table, plus migrations. Its main queries are time-series aggregations: bucket hourly points into hours or days with `date_trunc`, apply each metric's rollup (sum or average, as the `metrics` table says), and compute a summary.

The options considered:

- **Plain SQL with the `pg` driver.** Full control, but no types for rows, and migrations need another tool.
- **Prisma.** Mature, with a polished API for records and relations. Its query API has no `date_trunc` grouping, so most of DashGen's queries would be raw SQL anyway. Version 7 also adds a generated client, a driver adapter and a config file. A test install turned up several setup pitfalls: npm's `latest` tag pointing to a release candidate, npm 12 blocking its install script, and `prisma init` writing a `.env` file.
- **Drizzle.** The schema is TypeScript, queries read like SQL with full types, and `drizzle-kit` generates plain SQL migration files. It has no generated client, no engine and no build step, so it runs under Node's type stripping. It's widely used, at about 35 million downloads a week against Prisma's 20 million.

## Decision

Drizzle (`drizzle-orm`) with the `pg` driver, and `drizzle-kit` for migrations.

- The schema lives in the `metrics` and `runs` modules. `drizzle-kit generate` writes each change as a SQL file, committed and reviewed with the code.
- Migrations and the seed run before the backend starts: as a one-off container in Docker Compose, and as a one-off ECS task on AWS.
- Tests run against a real Postgres, locally and in CI.

## Consequences

- The bucketing, joins and transactions are visible in typed code, which keeps every query reviewable.
- One schema in TypeScript gives the table types, the migrations, and with `drizzle-zod` if needed, Zod schemas.
- Drizzle's stable release is 0.45, with 1.0 in beta, so minor versions can still change APIs. Versions are pinned, and upgrades are their own PRs.
- For an app made mostly of records and deep relations, Prisma's API would save more time. That's not DashGen.
