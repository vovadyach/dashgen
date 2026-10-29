# Backend

Node.js 24 + Fastify, in TypeScript. Takes a question and returns a chart; the Gemini agent arrives in step 3.

- Code in `src/`, tests in `test/`. Node runs the `.ts` files directly, so there's no build step: `tsc` only checks types.
- Run it with `npm run dev` from the repo root: port 3000, restarts on changes, reads `backend/.env`. API docs at http://localhost:3000/docs.
- It's a package in the repo's npm workspace: install from the root with `make install`. In this folder, `npm test` and `npm run typecheck` check just the backend. Formatting and linting run from the root (`npm run format`, `npm run lint`), or all of it with `make check`.

## Conventions

- Settings are read in `loadConfig` in `config.ts`, through a Zod schema. A new setting goes there and into `.env.example`. Secrets are wrapped in `Secret`, so they never reach logs.
- Each module keeps its tables in its own `schema.ts` (`metrics/`, `runs/`), and `db.ts` opens the connection pool and runs the migrations.
- Modules take what they need as parameters, like `createMetrics(db, { now, log })`, so tests can pass a test database, a fixed clock and their own logger. Logging levels and the "log once, where it's handled" rule are in `src/logger.ts`.
- `buildApp(config)` builds the app, so each test can pass its own config. Nothing else reads the environment.
- Each route declares Zod schemas for its body and responses. They validate requests, type the handler, check replies and generate the docs at `/docs`. A schema that a client also needs lives in `packages/contracts` and is imported from `@dashgen/contracts`.
- Errors are thrown as `ApiError(status, code, message)`, so clients get `{"error": {"code": "...", "message": "..."}}`. The message must be safe to show visitors.
- Logging is Pino, through Fastify: a short, stable message naming the event, with context as fields (`{ tool, args, ms }`), never secrets or the values in SQL. `LOG_LEVEL=debug` adds every SQL statement, and `npm run dev` shows readable lines through `pino-pretty`. Expected errors throw with a reason; only the central handler logs unexpected ones, once.
- Per-route behavior, like the rate limit, goes in the route's options: `config: { rateLimit: ... }`.
- Only TypeScript that Node can strip: no `enum`, no parameter properties, and relative imports end in `.ts`. The `erasableSyntaxOnly` setting enforces it.
- No `any`, and ESLint's type-aware rules must pass, including the one against promises nobody awaits.
- Tests use `node:test`, split by what they need:
  - `test/unit/`: pure logic, with no database or network. `npm run test:unit` runs them without Docker.
  - `test/integration/`: real parts together. Routes go through `app.inject()` (`startApp` in `test/helpers/app.ts`), and Postgres through `createTestDb()` (`test/helpers/db.ts`), which gives each file its own migrated database.
  - Inside each, a subfolder per module once a module has several test files. Tests never call Gemini; from step 3 the agent gets a fake model.
