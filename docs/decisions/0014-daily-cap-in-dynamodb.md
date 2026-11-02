# 14. The daily cap counts in DynamoDB

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

The demo is public once it's deployed (step 5), and every question costs Gemini money. The [daily cap](../design.md#the-daily-cap) stops at 150 questions a day, for every visitor together. Its count has three needs:

- **It outlives each session.** `make down` destroys the session stack after every work session, the database included.
- **It's atomic,** so two requests can't both take the last question.
- **It costs almost nothing while idle,** within the ~$5 a month AWS gets.

The options considered:

- **Postgres.** It's there already, but it's destroyed with each session, so the count would start over, and two sessions on one day would get two days' worth.
- **Redis on ElastiCache.** `INCR` is atomic, but it's a server that has to stay on all month: about $6 a month at least, more than the rest of AWS. It also lives in a VPC, which is in the session stack.
- **Upstash,** a hosted Redis with a free tier. That's another company, account and secret, outside AWS and Terraform.
- **DynamoDB.** No server, paid per request: a fraction of a cent a month at 150 writes a day. One conditional write checks the count and adds to it in one step, and the table lives in the always-on stack.

## Decision

- DynamoDB holds an item per UTC day: `day`, `used`, and an `expires_at` a month later, after which DynamoDB's TTL deletes it, once Terraform turns TTL on in step 5. Each question takes a place with one conditional `UpdateItem` before its run starts (`backend/src/cap/`), and never gives it back, since a failed run may already have spent tokens.
- **It fails closed.** When DynamoDB doesn't answer within 2 seconds, the question gets a 503 `unavailable`, and Gemini isn't called. The write gets no retry, since a second try after a lost reply would count one question twice.
- Only `@aws-sdk/client-dynamodb`, with raw attribute values instead of `@aws-sdk/lib-dynamodb`, since there's only one write.
- DynamoDB Local runs in Docker Compose: on port 8000 for development, in memory, and the backend makes its table when it starts. On port 8001 for tests, with a table per test file. The client uses fake keys, so a local run can't reach a real AWS account. AWS's table, and the task's role to reach it, come with Terraform in step 5.

## Consequences

- The count survives every session and deploy, costs almost nothing, and can't be taken twice. More backend tasks would share it, and the rate limit could move there too.
- The same code runs locally and on AWS.
- One more AWS service and SDK package, and DynamoDB Local, a Java image of about 240 MB, in Compose and CI.
- A DynamoDB outage stops every question. That's the cost of failing closed.
- A lost reply wastes one of the day's places, since the write isn't retried: the day can end with fewer questions answered, never more.
- Locally, the count starts over whenever DynamoDB Local's container restarts.
- Any lookup other than by day needs planning up front ([ADR-0008](0008-postgres.md)).
