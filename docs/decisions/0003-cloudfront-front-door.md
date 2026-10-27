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

## Decision

S3 and CloudFront stay on between sessions, and CloudFront is the only address visitors use.

- CloudFront serves the React build from S3 and forwards `/api/*` to the load balancer, so the browser talks to one origin.
- No domain. HTTPS comes from CloudFront's default `*.cloudfront.net` certificate.
- Each session's load balancer gets a new address, so `make up` points CloudFront's `/api/*` at it and `make down` points it away again.
- The load balancer accepts only our CloudFront. Its security group allows only CloudFront's IP ranges, but every CloudFront customer shares those, so CloudFront also adds a secret header. Terraform generates the secret, it never appears in the repo, and the load balancer answers 403 to any request without it.
- When `/api/health` fails, the page says the live demo is offline and disables the question box. CloudFront tries the origin once and gives up after about 2 seconds, so the page doesn't hang.

## Consequences

- The link never changes, and the page works between sessions.
- No CORS: the app and the API share an origin.
- The always-on part costs a few cents a month at this traffic.
- The hop from CloudFront to the load balancer is plain HTTP, because without a domain the load balancer can't get a certificate. It carries only demo questions.
- The rate limit has to read the visitor's IP from the header CloudFront adds. Otherwise every visitor looks like CloudFront and shares one limit.
- `make up` and `make down` must update CloudFront, and each update takes a few minutes to roll out.
- An internal load balancer behind a CloudFront VPC origin would leave nothing public but CloudFront. It's the option to revisit if the secret header isn't enough, at the cost of one more resource to rebuild every session.
