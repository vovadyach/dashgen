# 13. Share links carry the chart

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

A visitor can copy a link to a chart. The AWS backend runs only during work sessions, and every deploy reseeds the database, so the `runs` history starts over ([roadmap](../roadmap.md), step 5).

Two ways to link a chart were considered:

- **A link to the run,** like `/?run=<id>`, which the page would fetch from a new `GET /api/runs/:id`. Short, but it breaks whenever the stack is down or the database is reseeded, which is most of the time.
- **A link that carries the chart.** A `Chart` holds its own numbers, so the link can hold the chart itself. Longer, but it opens with no backend at all.

## Decision

- The link carries the chart after `#chart=`: its JSON, compressed with the browser's `CompressionStream` (deflate) and written as base64url (`frontend/src/share.ts`). Browsers don't send the part after `#` to a server, so the chart never reaches CloudFront or its logs.
- Opening a link draws the chart with no run and no call to Gemini. Then the address goes back to the page's own.
- Anyone can write a link, so the page treats it like the backend's answers: it's parsed with the `Chart` schema, and refused when it's over 50,000 characters, or over 1 MB once unpacked. The second cap stops a short link that unpacks to gigabytes.

## Consequences

- Links never expire and need no backend, so they work between work sessions too.
- Links are longer: about 300 characters for a week of one service, and about 2,000 for the largest chart, five services over 48 hours. Chat apps and email handle that.
- A link's numbers can be made up, under DashGen's address. The page says so under the chart: "Opened from a link, which carries its own numbers."
- No new dependency: compression and base64 are built into browsers.
