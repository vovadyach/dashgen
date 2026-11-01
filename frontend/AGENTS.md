# Frontend

React 19 + Vite, in TypeScript. The page where a visitor asks a question, watches the agent's steps and gets the chart.

- Code in `src/`, tests in `test/`.
- Run it with `make dev` from the repo root, which also starts Postgres and the backend, or alone with `npm run dev:frontend`: Vite on :5173, which forwards `/api` to the backend on :3000. In this folder, `npm test`, `npm run typecheck` and `npm run build` check just the page. Formatting and linting run from the root, or all of it with `make check`.

## Conventions

- The page calls only `/api/...` paths, never a full URL: locally Vite forwards them, and on AWS CloudFront does ([ADR-0003](../docs/decisions/0003-cloudfront-front-door.md)).
- What the backend sends is parsed with the schemas in `@dashgen/contracts` (`AskResponse`, `ErrorBody`, `RunEvent`). A shape the page doesn't know ends the run with an error, instead of breaking the page.
- Values the page and the backend both show, like the example questions and the sample services, live in `@dashgen/contracts`.
- `src/run.ts` holds a question's state. `nextRun()` is a plain reducer, tested without React, and `useRun()` connects it to `POST /api/ask` and the run's `EventSource`. A failed `POST /api/ask` is never retried by itself: each one starts, and pays for, a run.
- `src/chart/options.ts` turns a `Chart` into AG Charts options, as plain data that tests check. `src/components/chart-view.tsx` draws them, and loads on its own, after the first question ([ADR-0012](../docs/decisions/0012-shadcn-and-ag-charts.md)). It sits inside `ChartBoundary`, so a chart that fails to load leaves the rest of the page. A new AG Charts module is registered there. Never import `ag-charts-enterprise`: it needs a paid license.
- `src/steps.ts` puts each tool call in plain words, with the tool's own name shown under it. A new tool gets its words there.
- The page's colors are CSS variables in `src/index.css`, and the charts' are in `src/chart/palette.ts`, since a canvas can't read CSS. They match, so change both together. Series take the palette's colors in order, which keeps neighbors apart for color-blind readers.
- A small script in `index.html` sets the theme before React loads, so a dark page never flashes white while the code downloads. `src/theme.tsx` takes over from there. Both use the `theme` key in `localStorage`.
- Days are UTC midnights, so they're labeled in UTC (`formatDay`), and hours in the visitor's time zone. The tests run in Los Angeles' time zone, where labeling a day in local time shows the day before.
- `src/components/ui/` holds shadcn/ui components, copied in as our own code. To add one, copy it from ui.shadcn.com and change its imports to relative paths.
- Relative imports end in `.ts` or `.tsx`, as in the backend.
- Motion only behind `motion-safe:`, so a visitor who turned on reduced motion gets none.
- ESLint adds React's hooks rules (`eslint-plugin-react-hooks`) here, on top of the repo's rules.
- Tests use Vitest, Testing Library and jsdom:
  - `test/app.test.tsx` drives the page as a visitor would, with `fetch` stubbed and `FakeEventSource` (`test/helpers/`) playing the backend's stream.
  - jsdom has no canvas, so there the chart is a stand-in, and `test/chart.test.ts` checks its options instead.
- `vite` is also a dev dependency of the root. Otherwise npm keeps it in `frontend/node_modules`, because the backend's `drizzle-kit` needs an older `esbuild` than Vite accepts, and Vitest's helpers, installed at the root, can't find it there.
