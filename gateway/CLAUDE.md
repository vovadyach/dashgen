# Gateway

Node.js 24 + Fastify, in TypeScript. Takes a question and returns a chart; the Gemini agent arrives in step 4.

- Code in `src/`, tests in `test/`. Node runs the `.ts` files directly, so there's no build step: `tsc` only checks types.
- Run it with `make gateway` from the repo root: port 3000, restarts on changes, reads `gateway/.env`. API docs at http://localhost:3000/docs.
- Checks: `npm run format:check`, `npm run lint`, `npm run typecheck` (strict) and `npm test`. `npm run format` fixes formatting.

## Conventions

- Settings are read in `loadConfig` in `config.ts`, through a Zod schema. A new setting goes there and into `.env.example`. Secrets are wrapped in `Secret`, so they never reach logs.
- `buildApp(config)` builds the app, so each test can pass its own config. Nothing else reads the environment.
- Each route declares Zod schemas for its body and responses. They validate requests, type the handler, check replies and generate the docs at `/docs`.
- Errors are thrown as `ApiError(status, code, message)`, so clients get `{"error": {"code": "...", "message": "..."}}`. The message must be safe to show visitors.
- Per-route behavior, like the rate limit, goes in the route's options: `config: { rateLimit: ... }`.
- Only TypeScript that Node can strip: no `enum`, no parameter properties, and relative imports end in `.ts`. The `erasableSyntaxOnly` setting enforces it.
- No `any`, and ESLint's type-aware rules must pass, including the one against promises nobody awaits.
- Tests use `node:test` and `startApp` from `test/helpers.ts`, which calls routes through `app.inject()` without opening a port. They never touch the network or Gemini. From step 4 the agent is tested with a fake model.
