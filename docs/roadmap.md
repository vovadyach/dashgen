# Roadmap

DashGen is built in nine steps. Each one ends with something that works end to end.
The reasoning behind bigger choices lives in [decisions](decisions/).

- Every step ships with its tests.
- Deploying early (step 3) means every later feature runs on real infrastructure, instead of one big deploy at the end.
- The AWS backend runs only while it's being worked on, and `terraform destroy` removes it after each session. Only a small stack stays on, so the link and the page keep working in between ([ADR-0003](decisions/0003-cloudfront-front-door.md)).

## 1. Foundation

- [x] Metrics service in Go with hardcoded data
- [x] Move the gateway from Express to Fastify and TypeScript ([ADR-0001](decisions/0001-node-gateway.md)), renaming `POST /chat` to `POST /ask` ([ADR-0002](decisions/0002-question-box.md))
- [x] npm workspaces: shared TypeScript tooling, and a `contracts` package for API schemas ([ADR-0004](decisions/0004-npm-workspaces.md))
- [x] Tests for the metrics service and the gateway
- [x] `scripts/check.sh`: one command that runs every formatter, linter, type checker and test
- [x] CI on GitHub Actions that runs `scripts/check.sh`
- [x] Claude Code setup: a `CLAUDE.md` per service, permissions, format and stop hooks, `fix-issue` and `adr` skills
- [x] `docs/architecture.md`: how the services fit together
- [x] README and Makefile brought up to date

**Done when:** `scripts/check.sh` passes locally and in CI, and failing checks send Claude back to fix them before it finishes.

## 2. Postgres and Docker

- [ ] `points`, `services` and `metrics` tables ([design](design.md#the-metrics-database))
- [ ] `runs` table with one row per agent run ([design](design.md#the-gateway-database))
- [ ] Seed script: 30 days of hourly data ending today, from a fixed random seed
- [ ] Metrics service reads from Postgres and serves the [new API](design.md#the-metrics-services-api): up to 30 days, hourly or daily buckets, and a summary
- [ ] One Postgres instance with a database, a user and migrations per service ([design](design.md#one-postgres-a-database-per-service))
- [ ] Dockerfiles for both services, and Docker Compose to run everything locally
- [ ] Tests against a real Postgres, locally and in CI
- [ ] ADR: why Postgres, why one instance with a database per service, and what changes at scale. It replaces design.md's [Why Postgres](design.md#why-postgres), which then links to it

**Done when:** `docker compose up` starts Postgres and both services, and the metrics service answers from seeded data.

## 3. Deploy to AWS

- [ ] AWS account with MFA and budget alerts at $10, $25 and $50
- [ ] All infrastructure defined in Terraform
- [ ] The always-on and session Terraform stacks from the [AWS design](design.md#on-aws)
- [ ] `terraform destroy` finishes cleanly: secrets deleted with no recovery window, RDS without a final snapshot, ECR repositories deleted with their images
- [ ] No database backups: every deploy reseeds the data, and the `runs` history starts over
- [ ] `terraform-reviewer` subagent (read-only) that reads `terraform plan` and reports only what would be deleted or replaced
- [ ] VPC with public and private subnets, a NAT gateway, and a gateway endpoint for DynamoDB
- [ ] ECR repositories for both images
- [ ] The gateway's routes move under `/api` (`/api/ask`, `/api/health`)
- [ ] CloudFront as the only address visitors use, with the `/api/*` settings, headers and timeouts from [ADR-0003](decisions/0003-cloudfront-front-door.md)
- [ ] A CloudFront Function and key-value store that send `/api/*` to the running session, or answer 503 `{"status": "offline"}` between sessions, and a `make down` that drains the API before `terraform destroy`
- [ ] Gateway on ECS Fargate behind a load balancer (ALB) that accepts only our CloudFront
- [ ] Metrics service on ECS Fargate in private subnets, reached through Service Connect
- [ ] Postgres on RDS (db.t4g.micro) in private subnets
- [ ] Database passwords and the Gemini key in AWS Secrets Manager, passed to the containers by ECS
- [ ] Structured JSON logs with a request ID, collected in CloudWatch
- [ ] Migrations and seed run as a one-off ECS task
- [ ] GitHub Actions builds the images and deploys them, signing in to AWS with OIDC instead of stored keys
- [ ] Rate limiting keyed on the visitor's IP from `CloudFront-Viewer-Address`, with a test that a forged `X-Forwarded-For` doesn't change it
- [ ] Deploy runbook: `docs/runbooks/deploy.md`

**Done when:**

- `terraform apply` builds the stack from nothing, GitHub Actions deploys to it, and `terraform destroy` removes everything except the small stack that stays.
- Through CloudFront, `/api/health` answers `{"status": "ok"}` over HTTPS during a session, and 503 `{"status": "offline"}` after `make down`. The runbook records how long that switch takes.
- After `make up`, `make down` and `make up` again, the CloudFront address is the same and `/api/health` is back to `{"status": "ok"}`.
- A request sent straight to the load balancer, skipping CloudFront, doesn't reach the gateway.

## 4. Agent and guardrails

- [ ] Chart format first: what the gateway returns and the frontend draws ([design](design.md#the-public-api))
- [ ] [Tools](design.md#the-agents-tools): `list_services`, `query_metrics`, `create_chart`, `clarify` and `decline`, each with a description that also says what it doesn't handle
- [ ] The gateway builds each chart from the query results `create_chart` names
- [ ] Read-only tools that accept only known service and metric names
- [ ] Hand-written Gemini function-calling loop that records each step, with timeouts on each call, 25 seconds per question, and the [per-question limits](design.md#the-daily-cap) on model calls and tokens
- [ ] Tool arguments and the final chart validated against their schemas
- [ ] `/api/ask`'s Zod schemas cover every status it can return, with one error shape, checked by a test. The API docs at `/docs` and the frontend's types (step 5) both come from them
- [ ] Errors classified as retryable or not; retries use exponential backoff with jitter
- [ ] A clarifying question with clickable choices, instead of a guess, when the question is vague
- [ ] Off-topic questions get a short refusal and example questions
- [ ] Maximum question length: 300 characters
- [ ] [Daily cap](design.md#the-daily-cap) of 150 questions, counted in DynamoDB, with DynamoDB Local in Docker Compose. In place before the agent is deployed
- [ ] A $20 monthly spend cap on the Gemini project, noted in the runbook
- [ ] Model name in config
- [ ] Each run saved to `runs`
- [ ] Tests against a scripted fake model, so no API calls

**Done when:** "Show errors for payments-service this week" returns a valid chart and the steps that produced it, a vague question gets a clarifying question back, and at the daily cap the gateway stops calling Gemini.

## 5. Frontend

- [ ] React + Vite + Tailwind + Recharts: question box, chart, steps panel
- [ ] Example questions under the box for first-time visitors
- [ ] The agent's steps streamed to the steps panel as they happen (SSE)
- [ ] Pin charts to a dashboard, saved in the browser with their data, so they still draw while the backend is offline
- [ ] A note under the question box says questions are saved
- [ ] Works on a phone
- [ ] API types shared with the gateway: the frontend imports its Zod schemas, so an API change that breaks the page fails `tsc` ([ADR-0001](decisions/0001-node-gateway.md))
- [ ] Component tests with Vitest
- [ ] Frontend checks added to `scripts/check.sh`, and a `frontend/CLAUDE.md`
- [ ] Vite's dev server forwards `/api` to the gateway, so the app calls the same paths locally and on AWS
- [ ] Deployed to the always-on S3 bucket behind CloudFront
- [ ] An offline banner that disables the question box when `/api/health` doesn't answer `{"status": "ok"}` within 3 seconds, or when `/api/ask` gets an unexpected response: anything but the gateway's JSON or its event stream (SSE), such as the offline 503 or CloudFront's own 502

**Done when:** the README's example question works in the browser, locally and on AWS, with the steps streaming through CloudFront too, and while the backend is down the page shows the offline banner instead.

## 6. Evals

- [ ] 20–30 test questions, each with the expected tool calls, chart type and chart data: values, dates and units
- [ ] Ambiguous questions where the right answer is a clarifying question
- [ ] Scored for accuracy; runs from the command line and in CI
- [ ] `eval-runner` subagent on Haiku that runs the evals and returns only the score and the failures

**Done when:** the README reports the agent's eval accuracy.

## 7. Cost and abuse controls

- [ ] Tokens, cost and latency recorded for every run in `runs`
- [ ] Cost per day and per question, read from `runs`
- [ ] A friendly message when the daily cap is hit, with a link to the demo video
- [ ] Invisible bot check (Cloudflare Turnstile)
- [ ] Model routing: a cheaper model first, a stronger one when its answer fails validation, kept only if evals show it saves money without losing accuracy

**Done when:** every run's cost is recorded, and cost per day and per question can be read from `runs`.

## 8. MCP server

- [ ] MCP server that exposes DashGen's tools to any MCP client
- [ ] Demo from Claude Code

**Done when:** Claude Code answers a metrics question through DashGen's MCP server.

## 9. Demo and write-up

- [ ] Full stack redeployed
- [ ] Demo video
- [ ] README for engineers: architecture, real numbers (eval accuracy, cost per question, latency) and a "One thing I got wrong" section
- [ ] Stack torn down

**Done when:** the README has the demo video and real numbers, and the stack is destroyed.

## Later

- Follow-ups: a "change this chart" box on each chart that sends only that chart
- "Build me a dashboard": one request creates several charts
- CSV and Excel upload (tables, not PDFs): S3 presigned URLs and SQS, anonymous sessions, files deleted after 24 hours
- WAF on the load balancer
- EventBridge Scheduler and Lambda to add fresh data every day
- CloudWatch dashboards and alarms
- Sign-in with Cognito
- Local Kubernetes with OrbStack
- A cheap always-on version on Lambda, so a live link can stay up
