# 15. The backend signs in to RDS as its admin user

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

On AWS, the backend needs a Postgres user, and a password that reaches its container without being in the repo, the image or Terraform's state. Locally, `postgres/init.sh` gives the backend a user of its own, which owns the `dashgen` database but isn't an admin.

RDS can make and keep only one password itself: the admin's. It keeps it in a Secrets Manager secret, never in Terraform's state, and deletes it with the database at the end of each session.

The options considered:

- **The admin user, `dashgen`.** Nothing to create first: the password exists as soon as the database does. But the backend gets admin rights (`rds_superuser`): it could create users and databases, and change any table.
- **A second user, as locally.** It needs a password from Terraform: an ephemeral one from the `random` provider, a new dependency, which a write-only argument keeps out of Terraform's state, as for the Gemini key. It also needs a step that signs in as the admin to create the user, before the migrations.
- **IAM database authentication.** No password at all: the task's role asks AWS for a token that lasts 15 minutes. It needs `@aws-sdk/rds-signer`, a new dependency, code that gets a new token for each new connection, and a user made first with `GRANT rds_iam`.

## Decision

- On AWS, the backend signs in to the `dashgen` database as RDS's admin user, also called `dashgen`.
- ECS passes the `password` field of RDS's secret as `PGPASSWORD`, and `DATABASE_URL` holds no password. node-postgres reads `PGPASSWORD` itself when the URL has none, so the backend's code doesn't change. A test checks it: `signs in with PGPASSWORD when the URL has no password, as on AWS` (`backend/test/integration/db.test.ts`).
- Locally, nothing changes: the backend keeps its own user.

## Consequences

- No password in the repo, the image, the task definition or Terraform's state, and nothing to create: RDS makes it, and deletes it with the database.
- No new dependency, and no change to the backend's code.
- On AWS, the backend has more rights than locally. A bug that let a visitor's text into SQL could drop tables or create users. Every query goes through Drizzle with parameters, and the agent's tools accept only known service and metric names, which keeps that unlikely. And the data is only the seed and the session's `runs`, rebuilt every session.
- `loadConfig` doesn't read `PGPASSWORD`: node-postgres does, so `config.ts` says so in a comment.
- RDS changes the password every 7 days, and ECS reads it only when a task starts. A session lasts hours, but a stack left up for a week would need its task restarted.
- Keeping data between sessions, or sharing the database with another service, would need a user of its own first: one of the other two options.
