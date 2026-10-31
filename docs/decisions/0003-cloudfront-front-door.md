# 3. CloudFront as the front door, with no domain

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

The React app needs hosting, and the backend runs only during work sessions: `terraform destroy` removes it afterwards to keep AWS around $5 a month. A visitor who opens the link between sessions should still see the page, with a note that the live demo is offline.

The options considered:

- **Vercel for the frontend.** Free and simple, but it skips the S3 and CloudFront setup this project exists to practice.
- **S3 and CloudFront in the destroyed stack.** The link would change every session and show nothing in between, and a new distribution takes minutes to create.
- **S3 and CloudFront always on, with `/api/*` sent to the load balancer.** One address for everything.

A domain was also considered, at about $10–15 a year plus a DNS zone. It would give the load balancer its own HTTPS certificate and a nicer link, but a URL shortener covers the link.

Each session's load balancer gets a new address, so something has to send `/api/*` to it during a session and answer for it between sessions. Changing CloudFront's settings at the start and end of every session would work, but each change takes minutes to roll out, a script has to get the order right, and `/api/*` still needs somewhere to point between sessions. A CloudFront Function can choose where each request goes instead.

## Decision

S3 and CloudFront stay on between sessions, and CloudFront is the only address visitors use.

- **One origin for the browser.** CloudFront serves the React build from S3 and forwards `/api/*` to the backend.
- **No domain.** HTTPS comes from CloudFront's default `*.cloudfront.net` certificate.
- **The gateway's routes live under `/api`** (`/api/ask`, `/api/health`). CloudFront passes the path on unchanged, so the same paths work locally, through CloudFront and in the load balancer's health check, and nothing rewrites them.
- **A CloudFront Function turns the API on and off.** It's a few lines of JavaScript that run on every `/api/*` request and look up the current session in a CloudFront KeyValueStore. If a session is running, the function sends the request to that session's load balancer, with that session's secret header. If not, it answers `503 {"status": "offline"}` itself, without contacting anything.
- **Each stack owns its part.** The always-on stack owns the distribution, the function and the store, which starts empty. The session stack owns the store's one entry: its load balancer's address and its secret. It writes the entry once the gateway is healthy. `make up` and `make down` apply and destroy the session stack without changing CloudFront's settings.
- **`make down` drains before it destroys.** It removes the entry first and waits until CloudFront answers `/api/health` with the offline 503. Then it waits 60 seconds more, longer than CloudFront's 30-second response timeout, so questions already in flight can finish. Only then does it destroy the load balancer and the rest.
- **The load balancer accepts only our CloudFront.** Its security group allows only CloudFront's IP ranges, but every CloudFront customer shares those, so the load balancer also requires the secret header and answers 403 without it. Terraform generates a new random secret every session, and it never appears in the repo.
- **`/api/*` caches nothing and allows POST.** It uses AWS's managed `CachingDisabled` policy, and `/api/health` also sends `Cache-Control: no-store`, so a "healthy" answer can't outlive the backend. CloudFront allows POST only together with GET, HEAD, OPTIONS, PUT, PATCH and DELETE, and the gateway answers 405 to the methods it doesn't use.
- **An origin request policy forwards two headers that CloudFront would otherwise leave out.** `Last-Event-ID`, which the browser sends when it reconnects to a run's stream, tells the gateway which events it already has ([ADR-0011](0011-rest-and-sse.md)). `CloudFront-Viewer-Address` carries the visitor's IP: the gateway's own connection comes from the load balancer, so without it every visitor would share one rate limit. It holds the IP and the source port, like `198.51.100.10:46532`, so the rate limit keeps the part before the last colon. The gateway never reads `X-Forwarded-For`: a visitor can put anything in it, and CloudFront appends to it instead of replacing it.
- **Three timeouts, each outer one longer than the one inside it:**
  - **The health check:** when the page opens, it gives `/api/health` 3 seconds. Only `{"status": "ok"}` counts as healthy. Anything else shows the offline banner and disables the question box.
  - **Connecting:** CloudFront gives up on the load balancer after 2 seconds and one attempt, instead of the default 3 attempts of 10 seconds.
  - **An answer:** CloudFront waits up to 30 seconds for an answer to start, and at most 30 seconds between its parts. The gateway's own limit for a whole question is 25 seconds, so a slow question ends with the gateway's clear error, not CloudFront's generic 504. CloudFront never retries a POST that timed out, so a question is never sent twice.

## Consequences

- The link never changes, and the page works between sessions.
- No CORS: the app and the API share an origin.
- The always-on part costs a few cents a month at this traffic. The function and the store are billed per request.
- Starting or ending a session never changes CloudFront's settings, so nothing waits minutes for a distribution update. It waits instead for the store's change to reach every edge location. AWS's launch post says that takes a few seconds, but nothing promises a bound, so step 3 measures it.
- Ending a session can still fail a few requests. `make down` can only check the edge location nearest to it, so another one that hasn't caught up can forward a request after the load balancer is gone. That visitor gets CloudFront's own 502 or 504, which the page treats like offline. The secret in such a request is no use by then, because no load balancer accepts it anymore.
- The function is code that runs at the edge, and AWS's test tools don't check whether it changed the origin, so only a real request through CloudFront proves it works.
- The hop from CloudFront to the load balancer is plain HTTP, because without a domain the load balancer can't get a certificate. The questions and the secret header cross it unencrypted. Someone who can watch that hop could copy the secret, reach the load balancer through a CloudFront distribution of their own, and send any IP they like, which gets past the per-IP limit. We accept that: the daily cap still limits the cost, and a stolen secret stops working when the session ends. AWS recommends HTTPS on this hop, which needs a domain.
- An internal load balancer behind a CloudFront VPC origin would leave nothing public but CloudFront, and no secret would cross the internet. It's the option to revisit if the secret header isn't enough. It costs one more resource to rebuild every session, and CloudFront's settings would change every session again, because a VPC origin points at one particular load balancer.
