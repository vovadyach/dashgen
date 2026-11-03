# Deploy

How DashGen gets onto AWS. Its Terraform is in `infra/aws/`, a folder per stack ([design](../design.md#on-aws)), and step 5 adds to this runbook as it builds each part.

Every stack needs Terraform 1.17 or newer, `aws login`, and `infra/aws/backend.hcl`, which the [account's runbook](aws-account.md#6-terraform-takes-over) makes. Every `terraform init` takes `-backend-config=../backend.hcl`.

## The always-on stack

`infra/aws/always-on` holds what stays on between sessions. So far, that's the daily cap's DynamoDB table, with TTL on `expires_at`, for under 1 cent a month. It stays on: never run `terraform destroy` there.

In `infra/aws/always-on`:

```
terraform init -backend-config=../backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

Its state is in the bucket at `always-on/terraform.tfstate`, next to the account's.
