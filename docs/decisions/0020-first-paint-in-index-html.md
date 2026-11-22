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
- **`index.html` also starts the page's health check while the code downloads** ([ADR-0003](0003-cloudfront-front-door.md)), with the same 3 seconds, and `seedOnline()` gives its answer to the first render. So the offline banner, which most visitors get between sessions, is in the page's first frame instead of pushing it down a moment later. Until it answers, the page counts as online, as before.
- **If the page's script can't load, or fails as it starts, the loader says "DashGen couldn't load. Reload the page."** With JavaScript off, a `<noscript>` line says DashGen needs it. Either way the loader never runs forever.

## Consequences

- On Slow 3G, the loader shows at 2.57 s instead of a blank page until 6.56 s, and the page itself comes at 6.40 s, 160 ms sooner, since its CSS no longer shares the line with its JavaScript. On slow 4G the first paint comes at 1.02 s instead of 1.92 s, and the page at 1.86 s.
- With the demo offline, a phone's layout shift on a first visit goes from 0.098 to 0 on slow 4G. On a return visit the code comes from the browser's cache and can run before the health check answers, so the banner can still come late: 543 ms on slow 4G, a shift of 0.152, 148 ms with no shift on fast 4G, and 12 ms on wifi. Keeping the last answer in the browser would fix that, with more state than the case is worth.
- Any delay leaves a band of speeds where the loader blinks: on screen for 139 ms at 4 Mbps, and 285 ms at 3 Mbps. Faster connections never see it, slower ones for half a second or more.
- `index.html` grows from 0.9 kB to 8.6 kB over the wire, with Brotli, and a visit after a deploy downloads the CSS again inside it, about 6 kB.
- The loader's colors copy `src/index.css`'s, and its health check's request and 3 seconds copy `src/health.ts`'s, which still judges the answer. Tests fail when they drift apart.
