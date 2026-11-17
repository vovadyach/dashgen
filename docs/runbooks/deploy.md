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
