# AWS account

How the AWS account behind DashGen is set up: once, by hand, in the AWS console. Everything after this is Terraform.

- **Never create an AWS Organization or Control Tower.** Either one ends the Free plan and its credits.
- **Use the root user only for account and billing settings.** Everyday work happens as an IAM user.

## 1. Create the account

1. At [aws.amazon.com/free](https://aws.amazon.com/free), choose **Create a free account**.
2. Use an email for this account only. A Gmail `+aws` address works, and still reaches the inbox.
3. Choose the **Free plan**:

| | Free plan |
|---|---|
| Credits | $100, plus $20 for each of 5 tasks in the console's **Explore AWS** widget |
| Charges | None: it can't charge the card |
| Ends | After 6 months, or when the credits run out. **Upgrade plan** in Billing keeps the account, with any credits left. |

4. Payment: a credit card. Support plan: **Basic**, which is free.

## 2. MFA on the root user

Account menu, then **Security credentials**, then **Assign MFA device**: a passkey or an authenticator app. Add a second device as a backup, since losing the only one locks root out.

## 3. An everyday admin login

As root:

1. Account menu, then **Account**. Under **IAM user and role access to Billing information**, choose **Activate IAM Access**. Without it, even an admin sees "Access denied" on costs and budgets.
2. **IAM**, then **Users**, then **Create user**:
   - Check **Provide user access to the AWS Management Console**, and choose **I want to create an IAM user**. IAM Identity Center needs an Organization.
   - A custom password, saved in a password manager first.
   - **Add user to group**: a new group, `admins`, with **AdministratorAccess**.
3. IAM **Dashboard**: create an **Account alias**. IAM users then sign in at `https://<alias>.signin.aws.amazon.com/console`, with the alias, their user name and their own password. Root signs in with its email instead.
4. Signed in as the new user: **Security credentials**, then two MFA devices.

The console can't rename an IAM user, but CloudShell (the `>_` icon in the console) can:

```
aws iam update-user --user-name <old-name> --new-user-name <new-name>
```

## 4. Budget alerts

As the admin user: **Budgets**, then **Create budget**, then **Customize (advanced)**, then **Cost budget**:

| Setting | Value |
|---|---|
| Name | `monthly-total` |
| Period, renewal, method | Monthly, recurring, fixed |
| Amount | $50, for all AWS services |
| Alerts, on actual costs, by email | 20% ($10), 50% ($25), 100% ($50) |

Budgets send alerts. They don't stop spending. This one also earns one of the 5 credit tasks. From step 6 on, Terraform manages it.

## 5. The AWS CLI

With AWS CLI 2.32 or newer:

```
aws login
```

Choose the region `us-east-1`, and sign in as the admin user in the browser that opens. The CLI gets short-lived credentials, refreshed for up to 12 hours. No access key is stored. `aws logout` signs out.

```
aws sts get-caller-identity
```

Its `Arn` ends with `user/<your-user-name>` when the CLI works.

## 6. Terraform takes over

`infra/account` is the Terraform stack for the account itself. It manages step 4's budget, and adds a filter that leaves out credits, so the alerts also fire while credits pay the bill. It stays on: never run `terraform destroy` there.

With Terraform 1.17 or newer, signed in with `aws login`, in `infra/account`:

1. `cp terraform.tfvars.example terraform.tfvars`, then put your alert email in it. Git ignores it.
2. The first time only, if step 4's budget exists: save this as `import.tf`, so Terraform takes the budget over instead of trying to create it again.

   ```hcl
   data "aws_caller_identity" "current" {}

   import {
     to = aws_budgets_budget.monthly_total
     id = "${data.aws_caller_identity.current.account_id}:monthly-total"
   }
   ```

3. Plan, read the plan, then apply exactly that plan:

   ```
   terraform init
   terraform plan -out=tfplan
   terraform apply tfplan
   ```

4. Delete `import.tf` and `tfplan`. `terraform plan` then says "No changes".

For now, the state is in `infra/account/terraform.tfstate`, on your machine only. Git ignores it, since it holds the email and the account ID. Don't delete it. If it's lost, the budget stays in AWS: do step 2 again to import it.
