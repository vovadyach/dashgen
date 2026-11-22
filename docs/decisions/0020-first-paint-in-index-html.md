# 20. The page's first paint comes from index.html alone

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

On a slow connection, the page stayed blank until its JavaScript arrived: 6.56 s on DevTools' Slow 3G (2 s per request, 50 kB/s), with a phone's CPU. The HTML had an empty `#root`, and its CSS came in a file of its own, a second request before anything could paint. The options were:

- **What shows first:** nothing, as before, a gray skeleton of the page, or a small chart that draws itself.
- **The CSS:** its own file, cached for a year, or inline in `index.html`, which every visit checks again (`no-cache`).

## Decision

- **`index.html` has a loader in `#root`: a pinned card's mini chart, one at a time, a line, then bars, then a pie, each drawing itself and fading out for the next, and "Loading DashGen…".** It shows what the page makes, in 5 kB. React replaces it as the page mounts. It shows only after 0.4 s, so a fast connection never sees it, and it appears at once rather than fading in, since browsers don't count a fade from nothing as a first paint. Its colors and its own small CSS are inline too, so it needs nothing else.
- **A build puts the page's CSS inline, in place of its link** (`frontend/first-paint.ts`, a few lines of Vite plugin, no package).

## Consequences

- On Slow 3G, the loader shows at 2.57 s instead of a blank page until 6.56 s, and the page itself comes at 6.40 s, 160 ms sooner, since its CSS no longer shares the line with its JavaScript. On slow 4G the first paint comes at 1.02 s instead of 1.92 s, and the page at 1.86 s.
- `index.html` grows from 0.9 kB to 8 kB over the wire, with Brotli, and a visit after a deploy downloads the CSS again inside it, about 6 kB.
- The loader's colors are copies of `src/index.css`'s. A test fails when they drift apart.
