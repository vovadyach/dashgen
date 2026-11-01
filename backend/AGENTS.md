# Backend

Node.js 24 + Fastify, in TypeScript. Takes a question, and the Gemini agent answers it with a chart.

- Code in `src/`, tests in `test/`. Node runs the `.ts` files directly, so there's no build step: `tsc` only checks types.
- Run it with `npm run dev` from the repo root: port 3000, restarts on changes, reads `backend/.env`. API docs at http://localhost:3000/docs.
- It's a package in the repo's npm workspace: install from the root with `make install`. In this folder, `npm test` and `npm run typecheck` check just the backend. Formatting and linting run from the root (`npm run format`, `npm run lint`), or all of it with `make check`.

## Conventions

- Settings are read in `loadConfig` in `config.ts`, through a Zod schema. A new setting goes there and into `.env.example`. Secrets are wrapped in `Secret`, so they never reach logs.
- Each module keeps its tables in its own `schema.ts` (`metrics/`, `runs/`), and `db.ts` opens the connection pool and runs the migrations.
- IDs are UUIDv7 ([ADR-0009](../docs/decisions/0009-uuidv7-ids.md)): `randomUUIDv7()` from `node:crypto` in code, and `uuidv7()` as a Postgres column default. Never v4 (`randomUUID()`, `gen_random_uuid()`, Drizzle's `defaultRandom()`).
- Inside a transaction, use `tx`, never `db`, and `await` each query in turn (`seedMetrics`). A transaction is one connection, so `Promise.all` there runs nothing in parallel, and after a failure the rest of its queries fail too. Outside transactions, `Promise.all` does run independent reads in parallel, on separate pool connections (`listServices`).
- A module's own Zod schemas and their types go in `types.ts`, checks beyond a schema's shape in `validation.ts`, and small general helpers, like `distinct`, in `helpers.ts`, so the other files only do the work (`agent/`). Schemas that another package also needs go in `packages/contracts` instead.
- Modules, `app.ts` and `server.ts` import a module only through its `index.ts` ([ADR-0005](../docs/decisions/0005-one-backend.md)); tests and scripts may reach inside. A helper that a second module needs moves to `src/shared/`. The app's foundations (`config.ts`, `db.ts`, `logger.ts`, `errors.ts`) stay at the top of `src/`.
- Modules take what they need as parameters, like `createMetrics(db, { now, log })`, so tests can pass a test database, a fixed clock and their own logger. Logging levels and the "log once, where it's handled" rule are in `src/logger.ts`.
- `buildApp(config, { runs })` builds the app, so each test can pass its own config, and fakes for Gemini and the database through `runs` (`startApp` does). Nothing else reads the environment.
- Each route declares Zod schemas for its body and responses. They validate requests, type the handler, check replies and generate the docs at `/docs`. A schema that a client also needs lives in `packages/contracts` and is imported from `@dashgen/contracts`.
- Errors are thrown as `ApiError(status, code, message)`, so clients get `{"error": {"code": "...", "message": "..."}}`. The message must be safe to show visitors.
- Logging is Pino, through Fastify: a short, stable message naming the event, with context as fields (`{ tool, args, ms }`), never secrets or the values in SQL. `LOG_LEVEL=debug` adds every SQL statement, and `npm run dev` shows readable lines through `pino-pretty`. Expected errors throw with a reason; only the central handler logs unexpected ones, once.
- Per-route behavior, like the rate limit, goes in the route's options: `config: { rateLimit: ... }`.
- Only TypeScript that Node can strip: no `enum`, no parameter properties, and relative imports end in `.ts`. The `erasableSyntaxOnly` setting enforces it.
- No `any`, and ESLint's type-aware rules must pass, including the one against promises nobody awaits.
- Tests use `node:test`, split by what they need:
  - `test/unit/`: pure logic, with no database or network. `npm run test:unit` runs them without Docker.
  - `test/integration/`: real parts together. Routes go through `app.inject()` (`startApp` in `test/helpers/app.ts`), and Postgres through `createTestDb()` (`test/helpers/db.ts`), which gives each file its own migrated database on the test Postgres that `make check` starts (or on `TEST_DATABASE_URL`, which must be Postgres 18 or later).
  - Inside each, a subfolder per module once a module has several test files. Tests never call Gemini: they use `fakeModel` from `test/helpers/model.ts`.
- Tests are grouped with `describe`, named for what they test: a function (`runAgent`) or a part of the app (`HTTP API`), with a `describe` inside for each group when there are many (`limits`, `POST /api/ask`). Each `it` reads on from its `describe`: `describe("query_metrics")`, then `it("fills in the default range of 7 days")`. The test report shows no file names, so the groups show where each test lives.
- Test files hold the tests, their `before`/`after` hooks, test case tables and small helpers for that file, like `ask()`. Test data goes in `test/fixtures/` (`QUESTION`, `CATALOG`, `VALID_ENV`), unless only one test uses it. Shared functions go in `test/helpers/`: fakes (`fakeModel`), builders (`reply()`), setup (`startApp()`) and checks (`assertRecentUuidV7()`).
