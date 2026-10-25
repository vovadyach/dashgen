# Roadmap

DashGen is built in nine steps. Each one ends with something that works end to end.
The reasoning behind bigger choices lives in [decisions](decisions/).

- Every step ships with its tests.
- Deploying early (step 3) means every later feature runs on real infrastructure, instead of one big deploy at the end.
- The AWS stack runs only while it's being worked on, and `terraform destroy` removes it after each session. Only the Terraform state and the domain's DNS stay.

## 1. Foundation

- [x] Metrics service in Go with hardcoded data
- [x] Move the gateway from Node.js to Python + FastAPI ([ADR-0001](decisions/0001-python-gateway.md)), renaming `POST /chat` to `POST /ask` ([ADR-0002](decisions/0002-question-box.md))
- [ ] Tests for the metrics service and the gateway
- [x] `scripts/check.sh`: one command that runs every formatter, linter, type checker and test
- [ ] CI on GitHub Actions that runs `scripts/check.sh`
- [x] Claude Code setup: a `CLAUDE.md` per service, permissions, format and stop hooks, `fix-issue` and `adr` skills
- [ ] `docs/architecture.md`: how the services fit together
- [x] README and Makefile brought up to date

**Done when:** `scripts/check.sh` passes locally and in CI, and failing checks send Claude back to fix them before it finishes.

## 2. Postgres and Docker

- [ ] `metrics` table (`name`, `value`, `dimension`, `recorded_at`) with a composite index on `(name, dimension, recorded_at)`
- [ ] `runs` table with one row per agent run
- [ ] Seed script that writes 30 days of hourly data relative to today, so "today" and "this week" always have data
- [ ] Metrics service reads from Postgres instead of hardcoded data
- [ ] Each service owns its tables, their migrations and its own database user: `metrics` belongs to the metrics service, `runs` to the gateway
- [ ] Dockerfiles for both services, and Docker Compose to run everything locally
- [ ] Tests against a real Postgres, locally and in CI
- [ ] ADR: why Postgres is enough for this data, and what would replace it at scale (TimescaleDB or ClickHouse)

**Done when:** `docker compose up` starts Postgres and both services, and the metrics service answers from seeded data.

## 3. Deploy to AWS

- [ ] AWS account with MFA and budget alerts at $10, $25 and $50
- [ ] All infrastructure defined in Terraform
- [ ] A small Terraform stack that stays between sessions: the state bucket and the domain's DNS. Everything else lives in the stack that `terraform destroy` removes
- [ ] `terraform destroy` finishes cleanly: secrets deleted with no recovery window, RDS without a final snapshot, ECR repositories deleted with their images
- [ ] No database backups: every deploy reseeds the data, and the `runs` history starts over
- [ ] `terraform-reviewer` subagent (read-only) that reads `terraform plan` and reports only what would be deleted or replaced
- [ ] VPC with public and private subnets and a NAT gateway
- [ ] ECR repositories for both images
- [ ] Domain name, bought through Route 53 or Cloudflare
- [ ] Gateway on ECS Fargate behind a public load balancer (ALB), with HTTPS from an ACM certificate for the domain
- [ ] Metrics service on ECS Fargate in private subnets, reached through Service Connect
- [ ] Postgres on RDS (db.t4g.micro) in private subnets
- [ ] Database passwords and the Gemini key in AWS Secrets Manager, passed to the containers by ECS
- [ ] Structured JSON logs with a request ID, collected in CloudWatch
- [ ] Migrations and seed run as a one-off ECS task
- [ ] GitHub Actions builds the images and deploys them, signing in to AWS with OIDC instead of stored keys
- [ ] Rate limiting keyed on the real client IP behind the load balancer
- [ ] Deploy runbook: `docs/runbooks/deploy.md`

**Done when:** `terraform apply` builds the stack from nothing, GitHub Actions deploys to it, the gateway's `/health` answers over HTTPS, and `terraform destroy` removes everything except the small stack that stays.

## 4. Agent and guardrails

- [ ] Chart format first: what the gateway returns and the frontend draws
- [ ] Tools: `list_services`, `query_metrics`, `create_chart`, each with a description that also says what it doesn't handle
- [ ] Read-only tools that accept only known service and metric names, so prompt injection can't do harm
- [ ] Hand-written Gemini function-calling loop with a step limit, timeouts and a record of each step
- [ ] Tool arguments and the final chart validated against their schemas
- [ ] Errors classified as retryable or not; retries use exponential backoff with jitter
- [ ] A clarifying question with clickable choices, instead of a guess, when the question is vague
- [ ] Off-topic questions get a short refusal and example questions
- [ ] Maximum question length
- [ ] Daily cap on Gemini calls for the whole app, counted from `runs` so every gateway container shares it, in place before the agent is deployed
- [ ] Model name in config
- [ ] Each run saved to `runs`
- [ ] Tests against a scripted fake model, so no API calls

**Done when:** "Show errors for payments-service this week" returns a valid chart and the steps that produced it, a vague question gets a clarifying question back, and at the daily cap the gateway stops calling Gemini.

## 5. Frontend

- [ ] React + Vite + Tailwind + Recharts: question box, chart, steps panel
- [ ] Example questions under the box for first-time visitors
- [ ] The agent's steps streamed to the steps panel as they happen (SSE)
- [ ] Pin charts to a dashboard, saved in the browser
- [ ] Works on a phone
- [ ] TypeScript API types generated from the gateway's OpenAPI schema
- [ ] Component tests with Vitest
- [ ] Frontend checks added to `scripts/check.sh`, and a `frontend/CLAUDE.md`
- [ ] Hosted on S3 behind CloudFront, added to the Terraform

**Done when:** the README's example question works in the browser, locally and on AWS.

## 6. Evals

- [ ] 20–30 test questions, each with the expected tool calls and chart type
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
