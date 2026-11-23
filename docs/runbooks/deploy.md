# Deploy

How DashGen gets onto AWS. Its Terraform is in `infra/aws/`, a folder per stack ([design](../design.md#on-aws)), and step 5 adds to this runbook as it builds each part.

Every stack needs Terraform 1.17 or newer, `aws login`, and `infra/aws/backend.hcl`, which the [account's runbook](aws-account.md#6-terraform-takes-over) makes. Every `terraform init` takes `-backend-config=../backend.hcl`.

## The always-on stack

`infra/aws/always-on` holds what stays on between sessions: CloudFront with the API's function, key-value store and origin request policy, the page's private S3 bucket, the daily cap's DynamoDB table, with TTL on `expires_at`, and the backend's ECR repository, `dashgen-backend`, for a few cents a month. The repository keeps CI's newest 3 images of the backend from `main`, 86 MB each, however old, and every other image for a week after its push, and scans each push for known vulnerabilities, for free ([ADR-0017](../decisions/0017-image-registry-always-on.md)). The session stack looks it up, so apply this stack before the next `make aws-up` after a change to it. To move a session made before ADR-0017, which holds its own copy of the repository under the same name: run `make aws-down` with the code that started it, then apply this stack, then start the next session. It stays on: never run `terraform destroy` there. The distribution and the table have `prevent_destroy`, because a new distribution gets a new address, and a new table loses the day's count.

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

It also needs one repository variable, `TURNSTILE_SITE_KEY`: the site key of DashGen's Turnstile widget ([the Turnstile widget](#the-turnstile-widget)). It's public, so it's a variable, not a secret. Without it, or with one of Cloudflare's test keys, `scripts/build-page.sh` stops before anything deploys, in the job or by hand, since the backend's real secret turns down a test key's tokens. It also stops on a key longer than a site key's 32 characters, like the secret key, which would be public in the page, and on one with a space or line break in it.

To deploy by hand, as when the job fails, from the repo root:

```
VITE_TURNSTILE_SITE_KEY=$(gh variable get TURNSTILE_SITE_KEY) scripts/build-page.sh &&
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

## The backend's image

The backend runs from an image of `backend/Dockerfile`, built for Fargate's ARM CPUs, in the always-on stack's ECR repository, `dashgen-backend` ([ADR-0017](../decisions/0017-image-registry-always-on.md)). A session runs one of two images:

| Image | Built by | Tags | Kept |
|---|---|---|---|
| `main` | GitHub Actions, after each merge to `main` | `main`, and `main-<commit>` | The newest 3, however old |
| `dev` | `make aws-deploy` or `make aws-image`, from your own code, in a session started with `TF_VAR_image_tag=dev` | `dev`, and `dev-<commit>`, with `-dirty-<time>-<6 random hex digits>` when files differ from the commit | A week after its push |

**GitHub Actions builds `main`** after every push to `main`, once the checks pass: the `deploy-backend` job in `.github/workflows/ci.yml` runs `scripts/ci-deploy-backend.sh` on GitHub's ARM runner. It signs in with OIDC, as the `dashgen-backend-deploy` role, which can only push to this repository, copy the session's task definitions, run the migrations task and restart the backend's service. The tasks it starts get the session's secrets, as any deploy's do, so only workflows on `main` can take the role. Then:

- **With no session up,** the image waits for the next `make aws-up`.
- **In a session that runs `main`,** the job runs the migrations, then restarts the backend on the new image, and waits until the load balancer finds it healthy, about 3 minutes. If the new image fails, ECS goes back to the old one, and the job fails.
- **In a session that runs `dev`, or one that `make aws-up` is still starting,** the job leaves it as it is. A starting session gets its own image from `make aws-up`: `main`'s newest, or your build.

**Every deploy pins one image by its digest,** CI's and `make aws-deploy`'s alike. It reads which image the tag points to once, copies the session's two task definition templates with that image's digest in place of the tag, and runs the migrations and the backend on the copies. So the backend always runs the code whose migrations just ran, even when `main` moves meanwhile.

- **Terraform registers the templates,** in families of their own, `dashgen-backend-template` and `dashgen-migrate-template`, so the newest template always has this stack's settings, like `AI_MODEL`. It leaves the running service to the deploy, so an apply never restarts the backend on an image that isn't built or migrated yet.
- **The copies go in `dashgen-backend` and `dashgen-migrate`.** ECS keeps each deploy's, which cost nothing.
- **Deploys take turns.** A deploy holds the session's lock, one item in the DynamoDB table `dashgen-deploy-lock`, from reading which image the session runs to the backend's update. A second deploy, from CI or from another terminal, says another deploy is running and waits, for up to 30 minutes. So two never interleave and leave the older image running.
- **A deploy checks the lock right before each change to ECS,** and renews it for 30 minutes. One whose lock ran out, as after a pause of over 30 minutes, and that another deploy took, stops before it changes anything. A lock that a stopped deploy left expires 30 minutes after its last check, and goes with the session anyway.
- **Two migrations never run at once.** A deploy that stops while its migrations task may still run, as when the wait for it fails, leaves the task running and keeps the lock, which expires within 30 minutes. Right after a start, ECS can leave a task out of its lists for a moment, and by then it lists it, so the next deploy waits until ECS shows it as `STOPPED`, not only stopping, before it starts its own.

The job needs one repository secret, set once, after `terraform apply` in `infra/aws/always-on` has made the role, and before the job's first run. It's a secret, since the role holds the account ID:

```
gh secret set AWS_BACKEND_DEPLOY_ROLE_ARN --body "$(terraform -chdir=infra/aws/always-on output -raw backend_deploy_role_arn)"
```

- **The first `main` image comes with the first merge after that.** Until then, `make aws-up` stops before Terraform builds anything, and says so, and `TF_VAR_image_tag=dev make aws-up` runs your own code meanwhile.
- **To run the job again,** as after a failure, rerun it from the run's page in the Actions tab. A rerun of `main`'s newest commit keeps the image its first run pushed, so the digest ECS may still need keeps its tags. A run, first or rerun, moves `main` only when git confirms that its commit is the one `main`'s image comes from, or newer, since GitHub doesn't promise to start runs in merge order. So an older run changes nothing, and can't roll back a newer image. When git can't tell, as after a rewrite of `main`'s history, the job fails, and its log says how to unblock it.
- **The job's log is public,** so the account ID shows as `***` there, and the migrations' output stays in `/dashgen/migrate`.
- **A merge during `make aws-down`** can fail the job, as the session goes away under it. There's nothing to fix: the image is in ECR.

## The API's door

CloudFront runs `infra/aws/always-on/functions/api.js` on every `/api/*` request ([ADR-0003](../decisions/0003-cloudfront-front-door.md)). It reads one entry, `session`, from the key-value store `dashgen-session`:

| The entry | `/api/*` answers |
|---|---|
| None, between sessions | `503 {"status": "offline"}`, from the function itself, with `x-cache: FunctionGeneratedResponse from cloudfront` |
| `{"loadBalancer": "…", "secret": "…"}` | What that load balancer answers. The function sends the secret as `x-origin-verify` and the visitor's IP as `x-viewer-ip`, and drops a visitor's own copies of both. |
| The same, with `"closing": true` | The offline answer, except for a run's stream, `GET /api/runs/<id>/events`, which still reaches the load balancer, so runs already started can finish. |
| Not JSON | CloudFront's own 503 page, with `x-cache: FunctionExecutionError from cloudfront`. No request reaches an origin. |

From a visitor's request, `/api/*` passes on only `Content-Type` and `Last-Event-ID`, through the origin request policy `dashgen-api`.

`make aws-up` writes the entry once the backend is healthy (`scripts/aws-open.sh`). `make aws-down` first marks it closing, drains, then deletes it (`scripts/aws-close.sh`). Each server in an edge location gets a change on its own, so one answer proves only that one server has it. Observed once, at the Los Angeles edge on 2026-11-16, and not a limit AWS promises:

- Checking `/api/health` every second, the first server had a change 22 to 28 seconds after the write.
- Checking every 0.2 seconds, 10 answers in a row were offline 42 seconds after a delete.

To turn the API off by hand, without destroying the stack, run `make aws-close` from the repo's root. It drains the way `make aws-down` does, so runs already started still stream their answers, and it stops when a check fails. `make aws-open` turns it on again.

Only when that can't run, delete the entry directly, in `infra/aws/always-on`. That also cuts off the streams of runs in progress. Each write names the store's current ETag, and gets a new one. Requests can still reach the load balancer until every server has the change, so wait for 10 offline answers in a row, then 60 seconds more, before destroying it:

```
KVS=$(terraform output -raw session_store_arn)
KE=$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS" --query ETag --output text)
aws cloudfront-keyvaluestore delete-key --kvs-arn "$KVS" --if-match "$KE" --key session
URL=$(terraform output -raw url)
n=0; until (( n >= 10 )); do curl -s "$URL/api/health" | grep -q '"offline"' && n=$((n+1)) || n=0; sleep 0.2; done
sleep 60
```

To run the function on a made-up request, without sending a real one. The request in `functions/test-event.json` carries a forged `x-origin-verify` and `x-viewer-ip`, which a forwarded request must no longer have. The test reads the store, but it doesn't check where the function sends the request:

```
ETAG=$(aws cloudfront describe-function --name dashgen-api --stage LIVE --query ETag --output text)
aws cloudfront test-function --name dashgen-api --stage LIVE --if-match "$ETAG" \
  --event-object fileb://functions/test-event.json --query 'TestResult.{Error: FunctionErrorMessage, Output: FunctionOutput}'
```

## The Turnstile widget

Cloudflare Turnstile checks that a person asks each question ([ADR-0021](../decisions/0021-turnstile-bot-check.md)). Its widget is made once, by hand, in Cloudflare, which Terraform doesn't manage. A free account is enough:

1. In Cloudflare's dashboard, open Turnstile, then add a widget.
2. Name it DashGen, add the page's hostname, which `terraform -chdir=infra/aws/always-on output -raw url` prints after `https://`, and pick the Invisible mode, so visitors never see it. Cloudflare allows that mode only when the site's privacy text references its [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/), which the note under the question box links to (`frontend/src/app.tsx`).
3. Keep its two keys:
   - The site key is public, and the shorter one: at most 32 characters. Set it as a repository variable, which the `deploy-page` job builds the page with ([the page](#the-page)):
     ```
     gh variable set TURNSTILE_SITE_KEY --body "the-site-key"
     ```
   - The secret key isn't, and is the longer one. `make aws-up` takes it from your shell as `TF_VAR_turnstile_secret_key`, like the model's key ([the session stack](#the-session-stack)).

- **Locally there's no check,** unless `backend/.env` sets `TURNSTILE_SECRET_KEY`. The page uses Cloudflare's test site key, which passes everyone, and `backend/.env.example` names Cloudflare's test secret keys.
- **To replace the secret key,** rotate it in the widget's settings, then end the session with `make aws-down` and start the next one with the new key.
- **A wrong secret key turns every question down** with `unavailable`, and the backend's log says `bot check misconfigured`, with Cloudflare's `invalid-input-secret` ([read the backend's logs](#read-the-backends-logs)). So ask a test question after each `make aws-up`. To fix the key, run `make aws-down`, then `make aws-up` with the right one.
- **Cloudflare's test keys don't work on AWS,** since a test secret turns down every real visitor's token, and the real secret turns down a test site key's. `make aws-up` and the backend stop on a test secret key, and CI on a test site key.
- **If the page deploy stops because the variable holds the secret key,** rotate the secret key in the widget's settings, since the job's log shows its variables. Then set the variable to the site key, and start the next session with the new secret key.
- **A session made before the backend needed the key keeps its old backend.** On AWS the backend won't start without `TURNSTILE_SECRET_KEY`, so CI's deploy skips a session whose template has none, and says so in its log, and `make aws-deploy` and `make aws-start` stop before they change anything. Its next `make aws-up`, with the key, updates the template and deploys the new image.

## The session stack

`infra/aws/session` holds what runs on AWS only while DashGen is being worked on, and costs money by the hour. So far it's the network, the database, the backend's secrets, the task that fills the database, and the backend itself, behind a load balancer ([design](../design.md#on-aws)):

- A VPC, `10.0.0.0/16`, with a public and a private subnet in each of two availability zones: us-east-1a and us-east-1b in this account. The zone `use1-az3` is left out, since Fargate doesn't run there.
- One NAT gateway, in the first zone, which the private subnets use to reach the internet.
- Gateway endpoints for DynamoDB and S3, so the daily cap's requests and the image's layers skip the NAT gateway, for free.
- The VPC's default security group, with its rules removed, so anything that forgets to pick a group gets no traffic.
- Postgres 18.6 on RDS: one db.t4g.micro in one zone of the private subnets, with 20 GB of encrypted storage. Its database and its admin user are both called `dashgen`, and it accepts only TLS connections.
- Security groups for the load balancer, the backend's tasks and the database. The load balancer's lets in only CloudFront's addresses, from a list AWS keeps up to date (`com.amazonaws.global.cloudfront.origin-facing`), and reaches only the backend, on port 3000. The backend's lets in only the load balancer, and may reach Postgres, on port 5432, and HTTPS: ECR, Secrets Manager, CloudWatch Logs, DynamoDB, and Gemini or Claude. Only the backend's group can reach Postgres.
- No backups and no final snapshot: each session starts with a new, empty database, and `make aws-down` deletes it with its data.
- The database's password, which RDS makes and keeps in a Secrets Manager secret of its own, named `rds!db-` and an ID. It's never in Terraform's state or the repo, and RDS deletes it with the database, at once, with no recovery window.
- The model's key, in a Secrets Manager secret named for its provider: `dashgen/gemini-api-key` or `dashgen/anthropic-api-key`. `make aws-up` takes it from your shell, and only that key, even when your shell has both. Terraform passes it to AWS without keeping a copy in its state or plan. `make aws-down` deletes it at once, with no recovery window.
- Turnstile's secret key, in the secret `dashgen/turnstile-secret-key`, which the backend sends to Cloudflare to check each question's token ([the Turnstile widget](#the-turnstile-widget)). Like the model's key, `make aws-up` takes it from your shell, Terraform keeps no copy, and `make aws-down` deletes it at once.
- Two IAM roles. ECS takes `dashgen-task-execution` to start the backend's tasks: it can read these three secrets, pull the image and write the tasks' logs, and nothing else. The backend's own role, `dashgen-backend`, can only count the day's questions in the always-on stack's daily cap table, with `UpdateItem`.
- An ECS cluster, `dashgen`, and the one-off task `dashgen-migrate`, which each deploy copies from the template `dashgen-migrate-template` ([the backend's image](#the-backends-image)): the migrations, then the seed, on Fargate's smallest size (0.25 vCPU, 0.5 GB), on ARM. It connects to Postgres with TLS, checked against RDS's certificates in the image (`backend/certs/`), with the password from RDS's secret as `PGPASSWORD`. Its output goes to the log group `/dashgen/migrate`, kept for a day.
- The backend's service, `dashgen-backend`, from the template `dashgen-backend-template`: exactly one task of the image's own command, `node src/server.ts`, on the same size. It gets the model's key as `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`, Turnstile's secret key as `TURNSTILE_SECRET_KEY`, the database's password as `PGPASSWORD`, and `AI_MODEL` when `TF_VAR_ai_model` sets one ([ADR-0016](../decisions/0016-ai-model-setting.md)), uses AWS's own DynamoDB (`DYNAMODB_REGION`), and allows CloudFront's address for CORS. A deploy stops the old task before it starts the new one. Its output goes to `/dashgen/backend`, kept for a day.
- The deploy lock, the DynamoDB table `dashgen-deploy-lock`, which holds one item while a deploy runs, so deploys take turns. On demand, it costs a fraction of a cent.
- A load balancer, `dashgen`, in the public subnets: plain HTTP on port 80, to the task on port 3000. It forwards only requests that carry this session's secret in the `x-origin-verify` header, a random UUID that Terraform makes each session, and answers 403 to anything else. It checks `/api/health` every 10 seconds, and calls a new task healthy after 2 answers in a row.

While it's up, it costs about $0.11 an hour, so about $82 if it's left up for a month:

| Part | Per hour |
|---|---|
| NAT gateway | $0.045 |
| The NAT gateway's public IP | $0.005 |
| Postgres, db.t4g.micro | $0.016 |
| Its 20 GB of storage, at $0.115 a GB a month | $0.003 |
| The password's secret, at $0.40 a month | $0.0005 |
| The model key's secret, at $0.40 a month | $0.0005 |
| Turnstile's secret, at $0.40 a month | $0.0005 |
| The migrations task, on ARM, only while it runs | $0.0099, so about $0.0002 a run |
| The load balancer | $0.0225, plus a little per use |
| The load balancer's two public IPs | $0.01 |
| The backend's task, on ARM | $0.0099 |
| Everything else | free |
| **Total** | **about $0.11** |

From the repo root, signed in with `aws login`:

```
read -rs TF_VAR_gemini_api_key && export TF_VAR_gemini_api_key   # paste the Gemini key, then Enter
# or, for Claude Haiku 5.5 instead of Gemini:
# export TF_VAR_ai_model=claude-haiku-5-5
# read -rs TF_VAR_anthropic_api_key && export TF_VAR_anthropic_api_key   # paste the Claude key
read -rs TF_VAR_turnstile_secret_key && export TF_VAR_turnstile_secret_key   # paste Turnstile's secret key
make aws-up       # shows the plan, builds it once you answer yes, deploys the backend on CI's main image, then opens the API's door
# or, to run your own code, as to test a branch before merging it:
# TF_VAR_image_tag=dev make aws-up
make aws-deploy   # in a dev session, after a code change: a new image, the migrations, then the backend again
make aws-down     # closes the door and lets questions in flight finish, then shows what goes, and destroys it once you answer yes
```

- **End every work session with `make aws-down`.**
- **Pick the image with `TF_VAR_image_tag`:** `main`, the default, is CI's, so `make aws-up` builds nothing, and checks that it exists before Terraform does anything. `dev` is your own code's, which `make aws-up` builds and pushes ([the backend's image](#the-backends-image)). Like `TF_VAR_ai_model`, Terraform checks the name, and written before the command, it lasts for that command only. So in a `dev` session, a later `make aws-up`, as to switch models, needs `TF_VAR_image_tag=dev` again: without it, `make aws-up` stops rather than switch the session to `main`.
- **`make aws-deploy` has three steps,** which `make aws-up` runs after Terraform, all under the deploy lock: in a session that runs `dev`, it builds your own code's image for ARM and pushes it to ECR as `dev`, then the migrations and the seed run as a one-off ECS task, and the backend starts, both on that build, pinned by its digest ([the backend's image](#the-backends-image)). So it deploys your build even when another checkout pushes `dev` meanwhile. In a session that runs `main`, it builds nothing, since CI builds that image, and only runs the migrations and restarts the backend on it. Each step also runs alone: `make aws-image` builds and pushes, and deploys nothing, and `make aws-migrate` and `make aws-start` each run the image that the session's tag points to when they run.
- **`make aws-up` needs the model's key and Turnstile's:** `TF_VAR_gemini_api_key` for the default Gemini model, or `TF_VAR_anthropic_api_key` when `TF_VAR_ai_model` names a Claude one, and `TF_VAR_turnstile_secret_key`. It stops at once without them. `read -s` keeps the key off the screen and out of your shell's history, and it lasts until you close the terminal. A plan, `make aws-down` and the `terraform-reviewer` work without it.
- **Pick the AWS model in your shell.** Set `TF_VAR_ai_model` or leave it unset for the default Gemini model. Terraform checks the name before creating resources. To switch between the two Gemini models during a session, change `TF_VAR_ai_model` and run `make aws-up` again. Both use the same key.
- **End the session before switching providers.** To switch from Gemini to Claude or back, run `make aws-down`, set the new model and its provider's key, then run `make aws-up`. If an `aws-up` plan shows that changing `name` would replace `aws_secretsmanager_secret.model_api_key`, decline the plan. ECS needs the current secret to restart the previous task if the deployment rolls back.
- **What each step checks.** All three stop at once when the stack is down, and the last two also stop when the session's image isn't in ECR yet. The repository outlives sessions, though, so in a `dev` session, an image from an earlier one counts: `make aws-start` alone would run that older code, and `make aws-deploy` builds the current code first. They also stop when a `dev` image is over 6 days old, since ECR deletes it a week after its push, and could do it during the session. CI's newest 3 `main` images stay however old they are. Only `make aws-deploy` keeps the order, so `make aws-start` alone doesn't know whether the migrations ran.
  - `make aws-image` takes about 2 to 3 minutes.
  - `make aws-migrate` takes about a minute. It prints the task's output, ending with `Seeded 7200 points.`, and fails when the task does.
  - `make aws-start` takes about 2 minutes. It waits until the load balancer's health check passes, and when that fails, shows why ECS stopped the task. That check asks `/api/health`, which shows only that the backend answers. The first question proves the rest (step 5): its 202 shows that its reservation in DynamoDB worked, and its chart, from the metrics in Postgres, and its row in `runs`, which the backend saves in the background, show that Postgres did.
- **The API's door opens last, and closes first.** After the deploy, `make aws-up` runs `make aws-open`, which writes the session entry and waits until CloudFront answers `{"status":"ok"}`, about half a minute. That answer proves CloudFront, the secret, the load balancer and the backend together. `make aws-down` first marks the entry closing, waits for 10 offline answers in a row, then 60 seconds more: about 2 minutes. While it closes, runs already started can still stream their answers. It keeps the closing entry while `terraform destroy` runs, and deletes it only once the destroy is done, so meanwhile `make aws-open` refuses to reopen the door, even from another terminal. If you cancel the destroy, the door stays closed: `FORCE_OPEN=1 make aws-open` reopens it, and `TAKEOVER=1 make aws-down` tries the teardown again. A second `make aws-down` stops while another one holds the door, since that one may still be waiting at its prompt; `TAKEOVER=1` is only for a teardown that was canceled or abandoned. Every write to the store names the version the script just read, so a change from another terminal stops the script instead of being undone. When a check fails, as with an expired sign-in or a state it can't read, or CloudFront keeps answering for the backend for 2 minutes, or the store changes during the wait, as when someone reopens the door, it stops before anything is destroyed, and says how to destroy without waiting.
- **Only CloudFront reaches the backend.** From your Mac, `curl -m 5 "http://$(terraform -chdir=infra/aws/session output -raw load_balancer)/api/health"` gets no answer, since the load balancer's group lets in only CloudFront. Through CloudFront, `/api/health` answers `{"status":"ok"}` while the door is open, and `{"status":"offline"}` again once it's closed.
- **Terraform in `make aws-up` and `make aws-down` touches only this stack.** `infra/aws/account` and `infra/aws/always-on` stay up, and nothing in the Makefile destroys them. The scripts only read the always-on stack's outputs, and write two things there: the store's session entry, and the backend's images, which `make aws-image` pushes to ECR.
- **They run `terraform init` first,** so they work on a new machine too, once `infra/aws/backend.hcl` exists. The state is at `session/terraform.tfstate`, beside the other two stacks'.
- **The first `make aws-up` adds 49 resources,** then deploys the backend and opens the door: about 13 minutes in all. The database takes the longest: about 5 minutes to create, and 2 to delete. The NAT gateway takes a minute or two each way.
- **After `make aws-down`, the console can still list a few resources that are gone.** The tag search lists deleted resources for a while, a deleted NAT gateway shows as `deleted` for about an hour, and ECS keeps listing Terraform's old templates as `INACTIVE`, and each deploy's 2 copies as `ACTIVE`, since nothing deregisters those. None of them costs anything.
- **Before applying a change to any stack,** check the plan for anything it would delete or replace. From the repo's root, `terraform -chdir=infra/aws/<stack> show -json tfplan | node scripts/plan-changes.js` prints only those, and the plan's summary. In Claude Code, the `terraform-reviewer` subagent runs it for you (`.claude/agents/terraform-reviewer.md`).

## Read the backend's logs

The backend writes one JSON line per event, with its level as a word, like `"error"`. The lines about an HTTP request carry its ID as `reqId`, and the agent's lines about a run also carry the run's `runId`. Lines from shared parts, like the SQL statements that `LOG_LEVEL=debug` adds, carry neither. ECS sends the backend's lines to the log group `/dashgen/backend`, and the migrations task's to `/dashgen/migrate`. Both keep a day, and `make aws-down` deletes them with the stack, so read them before that.

```
aws logs tail /dashgen/backend --follow --format short     # the backend, live
aws logs tail /dashgen/migrate --since 1h --format short   # the last migrations
aws logs filter-log-events --log-group-name /dashgen/backend \
  --filter-pattern '{ $.reqId = "REQUEST_ID" }' \
  --query 'events[].[message]' --output text               # one request's lines, one a line
```

- **A request's ID** comes back in its response's `x-request-id` header. For a run, use `{ $.runId = "RUN_ID" }`, with the `runId` from `POST /api/ask`'s answer or the `runs` table.
- **Warnings and errors:** `{ ($.level = "warn") || ($.level = "error") }`.
- **Failed requests:** `{ $.res.statusCode >= 400 }`. A request the backend refuses on purpose, like a question past the daily cap, which gets a 503, is logged at `info`, so the filter above misses it.
- **Without `--follow`,** `aws logs tail` prints the last 10 minutes, or the time `--since` gives, and stops.
- **A backend that can't start,** like one missing a setting, stops before its logger exists, so its reason is plain text. `aws logs tail` shows it, but the JSON filters above don't.
