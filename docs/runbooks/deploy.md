# Deploy

How DashGen gets onto AWS. Its Terraform is in `infra/aws/`, a folder per stack ([design](../design.md#on-aws)), and step 5 adds to this runbook as it builds each part.

Every stack needs Terraform 1.17 or newer, `aws login`, and `infra/aws/backend.hcl`, which the [account's runbook](aws-account.md#6-terraform-takes-over) makes. Every `terraform init` takes `-backend-config=../backend.hcl`.

## The always-on stack

`infra/aws/always-on` holds what stays on between sessions: CloudFront, the page's private S3 bucket, and the daily cap's DynamoDB table, with TTL on `expires_at`, for a few cents a month. It stays on: never run `terraform destroy` there. The distribution and the table have `prevent_destroy`, because a new distribution gets a new address, and a new table loses the day's count.

In `infra/aws/always-on`:

```
terraform init -backend-config=../backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

A change to the distribution takes a few minutes to apply, because Terraform waits until every edge location has it. The state is in the bucket at `always-on/terraform.tfstate`, next to the account's.

## The page

The page is Vite's build of `frontend/`, in a private bucket that only our CloudFront distribution can read. `terraform -chdir=infra/aws/always-on output -raw url` prints its address. To deploy it, from the repo root:

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
