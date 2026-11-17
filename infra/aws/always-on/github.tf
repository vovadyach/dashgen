# GitHub Actions deploys the page with no AWS keys stored in GitHub: each run
# gets a short-lived token from GitHub, and AWS trades it for the role below
# (docs/runbooks/deploy.md#the-page).

locals {
  github_repository = "vovadyach/dashgen"
}

# AWS trusts tokens from GitHub's OIDC issuer. One per account. AWS checks
# GitHub's certificate itself, so it needs no thumbprint.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only a run on this repo's main branch can take the role: a pull request's
# run, or another repo's, gets a token with a different subject, and AWS
# refuses it.
resource "aws_iam_role" "page_deploy" {
  name        = "dashgen-page-deploy"
  description = "GitHub Actions uploads the page's build from main"

  assume_role_policy = jsonencode({
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
