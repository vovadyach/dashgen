# Deploy

How DashGen gets onto AWS. Its Terraform is in `infra/aws/`, a folder per stack ([design](../design.md#on-aws)), and step 5 adds to this runbook as it builds each part.

Every stack needs Terraform 1.17 or newer, `aws login`, and `infra/aws/backend.hcl`, which the [account's runbook](aws-account.md#6-terraform-takes-over) makes. Every `terraform init` takes `-backend-config=../backend.hcl`.

## The always-on stack

`infra/aws/always-on` holds what stays on between sessions: CloudFront with the API's function and key-value store, the page's private S3 bucket, and the daily cap's DynamoDB table, with TTL on `expires_at`, for a few cents a month. It stays on: never run `terraform destroy` there. The distribution and the table have `prevent_destroy`, because a new distribution gets a new address, and a new table loses the day's count.

In `infra/aws/always-on`:

```
terraform init -backend-config=../backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

A change to the distribution takes a few minutes to apply, because Terraform waits until every edge location has it. The state is in the bucket at `always-on/terraform.tfstate`, next to the account's.

## The page

The page is Vite's build of `frontend/`, in a private bucket that only our CloudFront distribution can read. `terraform -chdir=infra/aws/always-on output -raw url` prints its address.

**GitHub Actions deploys it** after every push to `main`, once the checks pass: the `deploy-page` job in `.github/workflows/ci.yml` runs the commands below. It signs in with OIDC (`infra/aws/always-on/github.tf`): GitHub gives each run a short-lived token, and AWS trades it for the `dashgen-page-deploy` role. Only a run on `main` of this repo can take that role, and it can only list the bucket and upload to it. No AWS keys are stored in GitHub.

The job needs two repository secrets, set once, after `terraform apply` in `infra/aws/always-on` has made the role, and before the job's first run. They're secrets, not variables, because both hold the account ID, and GitHub hides secrets in its logs, which are public here:

```
gh secret set AWS_PAGE_DEPLOY_ROLE_ARN --body "$(terraform -chdir=infra/aws/always-on output -raw page_deploy_role_arn)"
gh secret set AWS_SITE_BUCKET --body "$(terraform -chdir=infra/aws/always-on output -raw site_bucket)"
```

To deploy by hand, as when the job fails, from the repo root:

```
npm run build --workspace frontend &&
  BUCKET=$(terraform -chdir=infra/aws/always-on output -raw site_bucket) &&
  aws s3 sync frontend/dist/assets "s3://$BUCKET/assets" --cache-control "public, max-age=31536000, immutable" &&
  aws s3 cp frontend/dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache"
```

- **The files in `assets/` are cached for a year,** by browsers and by CloudFront. Their names hold a hash of their contents, so a new build has new names.
- **`index.html` keeps its name,** so browsers check it on every visit, and CloudFront keeps it for 1 second, its cache policy's minimum. A deploy needs no invalidation.
- **The assets go up first, and `&&` stops at the first command that fails,** so `index.html` never points to files that aren't there.
- **Old assets stay,** so a page that's already open can still load its chart code. Each deploy leaves up to 1.8 MB.

An invalidation makes every edge location drop its copies, so the next requests go to S3. It's for a file that went up wrong, and `/*` counts as one of the 1,000 free paths a month:

```
aws cloudfront create-invalidation --distribution-id "$(terraform -chdir=infra/aws/always-on output -raw distribution_id)" --paths "/*"
```

## The API's door

CloudFront runs `infra/aws/always-on/functions/api.js` on every `/api/*` request ([ADR-0003](../decisions/0003-cloudfront-front-door.md)). It reads one entry, `session`, from the key-value store `dashgen-session`:

| The entry | `/api/*` answers |
|---|---|
| None, between sessions | `503 {"status": "offline"}`, from the function itself, with `x-cache: FunctionGeneratedResponse from cloudfront` |
| `{"loadBalancer": "…", "secret": "…"}` | What that load balancer answers. The function sends the secret as `x-origin-verify`, and drops a visitor's own copy. |
| Not JSON | CloudFront's own 503 page, with `x-cache: FunctionExecutionError from cloudfront`. No request reaches an origin. |

The session stack will write and delete the entry. Each server in an edge location gets a change on its own, so one answer proves only that one server has it. Observed once, at the Los Angeles edge on 2026-11-16, and not a limit AWS promises:

- Checking `/api/health` every second, the first server had a change 22 to 28 seconds after the write.
- Checking every 0.2 seconds, 10 answers in a row were offline 42 seconds after a delete.

To turn the API off by hand, in `infra/aws/always-on`. Each write names the store's current ETag, and gets a new one. Requests can still reach the load balancer until every server has the change, so wait for 10 offline answers in a row, then 60 seconds more, before destroying it:

```
KVS=$(terraform output -raw session_store_arn)
KE=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS" --query ETag --output text)
aws cloudfront-keyvaluestore delete-key --kvs-arn "$KVS" --if-match "$KE" --key session
URL=$(terraform output -raw url)
n=0; until (( n >= 10 )); do curl -s "$URL/api/health" | grep -q '"offline"' && n=$((n+1)) || n=0; sleep 0.2; done
```

To run the function on a made-up request, without sending a real one. The request in `functions/test-event.json` carries a forged `x-origin-verify`, which a forwarded request must no longer have. The test reads the store, but it doesn't check where the function sends the request:

```
ETAG=$(aws cloudfront describe-function --name dashgen-api --stage LIVE --query ETag --output text)
aws cloudfront test-function --name dashgen-api --stage LIVE --if-match "$ETAG" \
  --event-object fileb://functions/test-event.json --query 'TestResult.{Error: FunctionErrorMessage, Output: FunctionOutput}'
```

## The session stack

`infra/aws/session` holds what runs on AWS only while DashGen is being worked on, and costs money by the hour. So far it's the network, the database, the backend's secrets and image, the task that fills the database, and the backend itself, behind a load balancer ([design](../design.md#on-aws)):

- A VPC, `10.0.0.0/16`, with a public and a private subnet in each of two availability zones: us-east-1a and us-east-1b in this account. The zone `use1-az3` is left out, since Fargate doesn't run there.
- One NAT gateway, in the first zone, which the private subnets use to reach the internet.
- Gateway endpoints for DynamoDB and S3, so the daily cap's requests and the image's layers skip the NAT gateway, for free.
- The VPC's default security group, with its rules removed, so anything that forgets to pick a group gets no traffic.
- Postgres 18.6 on RDS: one db.t4g.micro in one zone of the private subnets, with 20 GB of encrypted storage. Its database and its admin user are both called `dashgen`, and it accepts only TLS connections.
- Security groups for the load balancer, the backend's tasks and the database. The load balancer's lets in only CloudFront's addresses, from a list AWS keeps up to date (`com.amazonaws.global.cloudfront.origin-facing`), and reaches only the backend, on port 3000. The backend's lets in only the load balancer, and may reach Postgres, on port 5432, and HTTPS: ECR, Secrets Manager, CloudWatch Logs, DynamoDB and Gemini. Only the backend's group can reach Postgres.
- No backups and no final snapshot: each session starts with a new, empty database, and `make aws-down` deletes it with its data.
- The database's password, which RDS makes and keeps in a Secrets Manager secret of its own, named `rds!db-` and an ID. It's never in Terraform's state or the repo, and RDS deletes it with the database, at once, with no recovery window.
- The Gemini key, in a Secrets Manager secret named `dashgen/gemini-api-key`. `make aws-up` takes it from your shell, and Terraform passes it to AWS without keeping a copy in its state or plan. `make aws-down` deletes it at once, with no recovery window.
- Two IAM roles. ECS takes `dashgen-task-execution` to start the backend's tasks: it can read these two secrets, pull the image and write the tasks' logs, and nothing else. The backend's own role, `dashgen-backend`, can only count the day's questions in the always-on stack's daily cap table, with `UpdateItem`.
- An ECR repository, `dashgen-backend`, for the backend's image, 83 MB. ECR scans each push for known vulnerabilities, for free. `make aws-down` deletes it with its images, so each session pushes the image again.
- An ECS cluster, `dashgen`, and the one-off task `dashgen-migrate`: the migrations, then the seed, on Fargate's smallest size (0.25 vCPU, 0.5 GB), on ARM. It connects to Postgres with TLS, checked against RDS's certificates in the image (`backend/certs/`), with the password from RDS's secret as `PGPASSWORD`. Its output goes to the log group `/dashgen/migrate`, kept for a day.
- The backend's service, `dashgen-backend`: exactly one task of the image's own command, `node src/server.ts`, on the same size. It gets the Gemini key and the database's password as `GEMINI_API_KEY` and `PGPASSWORD`, uses AWS's own DynamoDB (`DYNAMODB_REGION`), and allows CloudFront's address for CORS. A deploy stops the old task before it starts the new one. Its output goes to `/dashgen/backend`, kept for a day.
- A load balancer, `dashgen`, in the public subnets: plain HTTP on port 80, to the task on port 3000. It forwards only requests that carry this session's secret in the `x-origin-verify` header, a random UUID that Terraform makes each session, and answers 403 to anything else. It checks `/api/health` every 10 seconds, and calls a new task healthy after 2 answers in a row.

While it's up, it costs about $0.11 an hour, so about $82 if it's left up for a month:

| Part | Per hour |
|---|---|
| NAT gateway | $0.045 |
| The NAT gateway's public IP | $0.005 |
| Postgres, db.t4g.micro | $0.016 |
| Its 20 GB of storage, at $0.115 a GB a month | $0.003 |
| The password's secret, at $0.40 a month | $0.0005 |
| The Gemini key's secret, at $0.40 a month | $0.0005 |
| The image in ECR, 83 MB at $0.10 a GB a month | under $0.0001 |
| The migrations task, on ARM, only while it runs | $0.0099, so about $0.0002 a run |
| The load balancer | $0.0225, plus a little per use |
| The load balancer's two public IPs | $0.01 |
| The backend's task, on ARM | $0.0099 |
| Everything else | free |
| **Total** | **about $0.11** |

From the repo root, signed in with `aws login`:

```
read -rs TF_VAR_gemini_api_key && export TF_VAR_gemini_api_key   # paste the Gemini key, then Enter
make aws-up       # shows the plan, builds it once you answer yes, then deploys the backend
make aws-deploy   # after a code change: a new image, the migrations, then the backend again
make aws-down     # shows what goes, and destroys it once you answer yes
```

- **End every work session with `make aws-down`.**
- **`make aws-deploy` has three steps,** which `make aws-up` runs after Terraform, and which also run alone: `make aws-image` builds the backend's image for ARM and pushes it to ECR, `make aws-migrate` runs the migrations and the seed as a one-off ECS task, and `make aws-start` runs the backend on that image.
- **`make aws-up` needs the Gemini key** in `TF_VAR_gemini_api_key`, and stops at once without it. `read -s` keeps the key off the screen and out of your shell's history, and it lasts until you close the terminal. A plan, `make aws-down` and the `terraform-reviewer` work without it.
- **What each step checks.** All three stop at once when the stack is down, and the last two also stop when there's no image yet. Only `make aws-deploy` keeps the order, so `make aws-start` alone doesn't know whether the migrations ran.
  - `make aws-image` takes about 2 to 3 minutes.
  - `make aws-migrate` takes about a minute. It prints the task's output, ending with `Seeded 7200 points.`, and fails when the task does.
  - `make aws-start` takes about 2 minutes. It waits until the load balancer's health check passes, and when that fails, shows why ECS stopped the task. That check asks `/api/health`, which shows only that the backend answers. The database and DynamoDB are proven by the first question, whose reservation in the daily cap writes to DynamoDB (step 5).
- **Only CloudFront reaches the backend.** From your Mac, `curl -m 5 "http://$(terraform -chdir=infra/aws/session output -raw load_balancer)/api/health"` gets no answer, since the load balancer's group lets in only CloudFront. Until CloudFront sends `/api/*` to the session (step 5), nothing reaches the backend, and the page shows its offline banner.
- **`make aws-up` and `make aws-down` touch only this stack.** `infra/aws/account` and `infra/aws/always-on` stay up, and nothing in the Makefile destroys them.
- **They run `terraform init` first,** so they work on a new machine too, once `infra/aws/backend.hcl` exists. The state is at `session/terraform.tfstate`, beside the other two stacks'.
- **The first `make aws-up` adds 47 resources,** then deploys the backend: about 12 minutes in all. The database takes the longest: about 5 minutes to create, and 2 to delete. The NAT gateway takes a minute or two each way.
- **After `make aws-down`, the console can still list a few resources that are gone.** The tag search lists deleted resources for a while, a deleted NAT gateway shows as `deleted` for about an hour, and ECS can keep listing old task definitions as `INACTIVE`. None of them costs anything.
- **Before applying a change to any stack,** check the plan for anything it would delete or replace. From the repo's root, `terraform -chdir=infra/aws/<stack> show -json tfplan | node scripts/plan-changes.js` prints only those, and the plan's summary. In Claude Code, the `terraform-reviewer` subagent runs it for you (`.claude/agents/terraform-reviewer.md`).
