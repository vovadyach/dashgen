# The backend's secrets (docs/design.md#on-aws). ECS reads them when the
# backend's task starts, and passes them to its container as environment
# variables, so they're never in the image, the task definition or Terraform's
# state.

# The Gemini key. make aws-up passes it from the shell, and Terraform hands it
# on to AWS without keeping a copy: a write-only argument. The secret costs
# $0.40 a month, charged by the hour, so $0.0005 an hour.
resource "aws_secretsmanager_secret" "gemini_api_key" {
  name        = "dashgen/gemini-api-key"
  description = "DashGen's Gemini API key, for the backend"

  # make aws-down deletes it at once, so the next session can make it again
  # under the same name. Otherwise the name stays taken for 7 to 30 days.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "gemini_api_key" {
  secret_id = aws_secretsmanager_secret.gemini_api_key.id

  # A plan without the key, like make aws-down's or terraform-reviewer's, gets
  # a placeholder, since the provider needs a value here even then. A plan
  # never sends it, and make aws-up refuses to run without the real key.
  secret_string_wo = coalesce(var.gemini_api_key, "no-key-given")

  # Terraform sends the key again only when this number changes. Each session
  # makes a new secret, which gets the key anyway.
  secret_string_wo_version = 1
}

# What ECS can pass to the backend's containers, by environment variable: the
# Gemini key, and the password from RDS's own secret (database.tf) as
# PGPASSWORD, which node-postgres reads when DATABASE_URL has no password
# (ADR-0015). Each task definition takes only the ones it needs (ecs.tf).
locals {
  secret_env = {
    GEMINI_API_KEY = aws_secretsmanager_secret.gemini_api_key.arn
    PGPASSWORD     = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::"
  }
}

# The role ECS takes to start the backend's tasks. Here it may read these two
# secrets; ecs.tf lets it pull the image and write the logs too. Nothing else.
resource "aws_iam_role" "task_execution" {
  name        = "dashgen-task-execution"
  description = "ECS starts the backend's task, with its secrets"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# The secrets use Secrets Manager's default key, so reading them needs no
# kms:Decrypt of its own.
resource "aws_iam_role_policy" "task_execution" {
  name = "read-the-secrets"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "secretsmanager:GetSecretValue"
      Resource = [
        aws_secretsmanager_secret.gemini_api_key.arn,
        aws_db_instance.main.master_user_secret[0].secret_arn,
      ]
    }]
  })
}
