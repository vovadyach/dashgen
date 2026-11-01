# Frontend

React 19 + Vite, in TypeScript. The page where a visitor asks a question, watches the agent's steps and gets the chart.

- Code in `src/`, tests in `test/`.
- Run it with `make dev` from the repo root, which also starts Postgres and the backend, or alone with `npm run dev:frontend`: Vite on :5173, which forwards `/api` to the backend on :3000. In this folder, `npm test`, `npm run typecheck` and `npm run build` check just the page. Formatting and linting run from the root, or all of it with `make check`.

## Conventions

- The page calls only `/api/...` paths, never a full URL: locally Vite forwards them, and on AWS CloudFront does ([ADR-0003](../docs/decisions/0003-cloudfront-front-door.md)).
- What the backend sends is parsed with the schemas in `@dashgen/contracts` (`AskResponse`, `ErrorBody`, `RunEvent`). A shape the page doesn't know ends the run with an error, instead of breaking the page.
- A chart from outside, in a share link or a pin saved in the browser, is parsed with the `Chart` schema too. Its caps on series and points keep out a chart larger than any the backend makes, and its hours and days must be real ISO times. The chart's card, the chart in it, and each pinned card sit inside a `ChartBoundary`, so one that fails leaves the rest of the page.
- The question box keeps its own text, so typing redraws only the box. The page puts a question in it through the box's handle, `show()`.
- Values the page and the backend both show, like the example questions and the sample services, live in `@dashgen/contracts`.
- `src/run.ts` holds a question's state. `nextRun()` is a plain reducer, tested without React, and `useRun()` connects it to `POST /api/ask` and the run's `EventSource`. A failed `POST /api/ask` is never retried by itself: each one starts, and pays for, a run. Each ask gets a number, and each stream event its run's ID, so the reducer takes a reply only for the current question: a late one, to a question that was stopped, changes nothing. The last answer stays, dimmed while the next question runs, and under the error if it fails.
- `src/chart/options.ts` turns a `Chart` into AG Charts options, as plain data that tests check. `src/components/chart-view.tsx` draws them, and loads on its own, after the first question ([ADR-0012](../docs/decisions/0012-shadcn-and-ag-charts.md)). It sits inside `ChartBoundary`, so a chart that fails to load leaves the rest of the page. A new AG Charts module is registered there. Never import `ag-charts-enterprise`: it needs a paid license.
- AG Charts redraws a chart from what changed in its options, and drops the settings of any option that's `enabled: false`. So a line without partial days still gets one plain segment (`dashedPartials()`), or the old chart stays on screen.
- `src/steps.ts` puts each tool call in plain words, with the tool's own name shown under it. A new tool gets its words there.
- The page's colors are CSS variables in `src/index.css`, and the charts' are in `src/chart/palette.ts`, since a canvas can't read CSS. They match, so change both together. Series take the palette's colors in order, which keeps neighbors apart for color-blind readers.
- A small script in `index.html` sets the theme before React loads, so a dark page never flashes white while the code downloads. `src/theme.tsx` takes over from there. Both use the `theme` key in `localStorage`.
- The watchlist is the charts pinned in this browser, with their numbers, under the `pins` key in `localStorage` (`src/pins.ts`). What it reads back is parsed with `Chart`, and an entry that fails is left out, so an old or edited one can't break the page. A pin or a share link opens with `open()` in `src/run.ts`: no run, no call to Gemini. A pin of a chart from a link keeps `fromLink`, so it keeps saying where its numbers came from. When the browser doesn't save a change, the watchlist says so, even with no pins left.
- Share links carry the chart itself, compressed, after `#chart=` (`src/share.ts`, [ADR-0013](../docs/decisions/0013-share-links-carry-the-chart.md)). Anyone can write one, so it's parsed with `Chart`, and capped in size before and after it's unpacked. `chartLink()` makes no link for a chart over those caps, and Copy link then says the chart is too large.
- The numbers over a chart, and the one a pinned chart's card leads with, come from `src/chart/summary.ts`, worked out from the chart's points, never by the model. A chart shape gets only numbers that are honest for it, or none.
- Download PNG uses AG Charts Community's own `download()`, on the chart that `ChartView` passes up through its `ref`.
- Days are UTC midnights, so they're labeled in UTC (`formatDay`), and hours in the visitor's time zone. The tests run in Los Angeles' time zone, where labeling a day in local time shows the day before.
- `src/components/ui/` holds shadcn/ui components, copied in as our own code. To add one, copy it from ui.shadcn.com and change its imports to relative paths.
- Relative imports end in `.ts` or `.tsx`, as in the backend.
- Motion only behind `motion-safe:`, so a visitor who turned on reduced motion gets none.
- ESLint adds React's hooks rules (`eslint-plugin-react-hooks`) here, on top of the repo's rules.
- Tests use Vitest, Testing Library and jsdom:
  - `test/app.test.tsx` drives the page as a visitor would, with `fetch` stubbed and `FakeEventSource` (`test/helpers/`) playing the backend's stream.
  - jsdom has no canvas, so there the chart is a stand-in, and `test/chart.test.ts` checks its options instead. The stand-in passes up a fake chart, so Download PNG can be tested.
- `vite` is also a dev dependency of the root. Otherwise npm keeps it in `frontend/node_modules`, because the backend's `drizzle-kit` needs an older `esbuild` than Vite accepts, and Vitest's helpers, installed at the root, can't find it there.
