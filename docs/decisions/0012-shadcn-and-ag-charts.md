# 12. shadcn/ui and AG Charts for the page

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The roadmap named React, Vite, Tailwind and Recharts for the page. Before building it, two choices got a second look: the chart library, since visitors judge DashGen by its charts, and the components around it. The page should look like a polished monitoring tool.

The chart libraries considered:

- **Recharts.** Common and simple, in SVG, about 150 KB gzipped, but its look is plain and familiar.
- **visx.** D3's math as small React pieces, and the lightest: about 50 KB for what DashGen would use. But the tooltips, legend, resizing and animations would be ours to write and test.
- **Highcharts.** The look we wanted, but free only for personal, non-commercial use, which doesn't fit an MIT repo that anyone may reuse.
- **AG Charts Community.** MIT, and the closest to Highcharts: tooltips, a legend, dark themes and keyboard access are built in. The biggest download.

For the rest of the page: Tailwind alone means writing every button, input and focus style; MUI or Mantine bring their own look and fight Tailwind; shadcn/ui gives accessible components, built on Tailwind and Radix, that are copied into the repo as our own code.

## Decision

- **AG Charts Community** draws the charts, on a canvas. Its code loads only once a question is sent, while the agent works, so the first page stays small. Only the community package is used: the enterprise one needs a paid license.
- **Tailwind and shadcn/ui** for everything else. The components live in `frontend/src/components/ui/`.
- **Every chart has a data table too,** so no value depends on hovering over a canvas.

## Consequences

- AG Charts is about 390 KB gzipped, three times the rest of the page (about 120 KB). Registering only the line, bar and pie charts barely shrinks it, so loading it late is what keeps the first page fast.
- Animations and the crosshair are Enterprise features. The page fades the chart in with CSS instead.
- CSS can't style a canvas, so the chart colors live in code (`src/chart/palette.ts`), matched to the page's CSS colors.
- jsdom has no canvas, so the page's tests use a stand-in for the chart, and test its options as data. Nothing automated checks the drawn chart.
- Copied components don't update themselves: a newer shadcn/ui version means copying them again.
