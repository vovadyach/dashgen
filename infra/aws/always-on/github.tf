# GitHub Actions deploys the page and the backend's image with no AWS keys
# stored in GitHub: each run gets a short-lived token from GitHub, and AWS
# trades it for one of the roles below (docs/runbooks/deploy.md#the-page,
# docs/runbooks/deploy.md#the-backends-image).

locals {
  github_repository = "vovadyach/dashgen"

  # Only a run on this repo's main branch can take these roles: a pull
  # request's run, or another repo's, gets a token with a different subject,
  # and AWS refuses it.
  github_main_trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${local.github_repository}:ref:refs/heads/main"
        }
      }
    }]
  })
}

# AWS trusts tokens from GitHub's OIDC issuer. One per account. AWS checks
# GitHub's certificate itself, so it needs no thumbprint.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "page_deploy" {
  name        = "dashgen-page-deploy"
  description = "GitHub Actions uploads the page's build from main"

  assume_role_policy = local.github_main_trust
}

# What the role can do: list the page's bucket, which aws s3 sync needs to
# compare, and upload to it. Nothing else, not even delete: old assets stay,
# so a page that's already open can still load its chart code.
resource "aws_iam_role_policy" "page_deploy" {
  name = "upload-the-page"
  role = aws_iam_role.page_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.site.arn
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.site.arn}/*"
      },
    ]
  })
}

# After each merge to main, CI builds the backend's image and pushes it to
# ECR, and when a session runs main, runs the migrations and restarts the
# backend on it (ADR-0017, scripts/ci-deploy-backend.sh).
resource "aws_iam_role" "backend_deploy" {
  name        = "dashgen-backend-deploy"
  description = "GitHub Actions pushes the backend's image from main, and deploys it to a session that runs main"

  assume_role_policy = local.github_main_trust
}

data "aws_region" "current" {}

locals {
  # The session's parts, which the role reaches only by these names. They
  # exist only while a session runs, and the session stack gives them these
  # names (infra/aws/session/).
  ecs_arn     = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}"
  ecs_cluster = "${local.ecs_arn}:cluster/dashgen"

  # The two families each deploy registers its copies in, pinned to one image
  # (scripts/aws-session.sh). The session's templates are in families of
  # their own, which only Terraform registers.
  ecs_deploy_families = [
    "${local.ecs_arn}:task-definition/dashgen-backend:*",
    "${local.ecs_arn}:task-definition/dashgen-migrate:*",
  ]
}

# What the role can do: push to the backend's repository, see which image a
# session runs, copy the session's task definitions pinned to one image, run
# the migrations task, and restart the backend's service. It can't create,
# change or delete anything else, or touch CloudFront, the budget or the
# daily cap. It can't read a secret itself, but the tasks it starts get the
# session's secrets, as any deploy's do, with any command a task definition
# gives them: that's why only workflows on main can take it.
resource "aws_iam_role_policy" "backend_deploy" {
  name = "push-and-deploy-the-backend"
  role = aws_iam_role.backend_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ECR's sign-in is for the whole registry, so it can't name a repository.
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.backend.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:UpdateService"]
        Resource = "${local.ecs_arn}:service/dashgen/dashgen-backend"
      },
      {
        # Reads the session's templates, and the copy the service runs. It
        # takes no resource: only "*" works here.
        Effect   = "Allow"
        Action   = "ecs:DescribeTaskDefinition"
        Resource = "*"
      },
      {
        # The copies, in their two families only.
        Effect   = "Allow"
        Action   = "ecs:RegisterTaskDefinition"
        Resource = local.ecs_deploy_families
      },
      {
        # The copies' tags, which say whether a session runs main or dev.
        Effect    = "Allow"
        Action    = "ecs:TagResource"
        Resource  = local.ecs_deploy_families
        Condition = { StringEquals = { "ecs:CreateAction" = "RegisterTaskDefinition" } }
      },
      {
        Effect   = "Allow"
        Action   = "ecs:ListTagsForResource"
        Resource = local.ecs_deploy_families
      },
      {
        # The session's deploy lock (infra/aws/session/deploy_lock.tf), so
        # CI's deploys and make's take turns: take it, renew it, give it back.
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:table/dashgen-deploy-lock"
      },
      {
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = "${local.ecs_arn}:task-definition/dashgen-migrate:*"
        Condition = { ArnEquals = { "ecs:cluster" = local.ecs_cluster } }
      },
      {
        # Waits for a task to stop, and shows why one did.
        Effect   = "Allow"
        Action   = "ecs:DescribeTasks"
        Resource = "${local.ecs_arn}:task/dashgen/*"
      },
      {
        Effect    = "Allow"
        Action    = "ecs:ListTasks"
        Resource  = "*"
        Condition = { ArnEquals = { "ecs:cluster" = local.ecs_cluster } }
      },
      {
        # A copied task definition, and the migrations task it runs, name
        # the session's two roles (infra/aws/session/): the execution role,
        # which reads the secrets when a task starts, so CI never sees them,
        # and the backend's own role.
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/dashgen-task-execution",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/dashgen-backend",
        ]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}
