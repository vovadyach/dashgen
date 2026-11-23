# The backend's secrets (docs/design.md#on-aws). ECS reads them when the
# backend's task starts, and passes them to its container as environment
# variables, so they're never in the image, the task definition or Terraform's
# state.

# The models the backend runs, with their providers: the names in MODELS, in
# backend/src/config.ts, which a test keeps the same. TF_VAR_ai_model must be
# one of them (variables.tf).
locals {
  model_providers = {
    "gemini-3.1-flash-lite" = "gemini"
    "gemini-3.5-flash-lite" = "gemini"
    "claude-haiku-5-5"      = "claude"
  }
  # Unset, the backend runs its own default, a Gemini model.
  model_provider = var.ai_model == null ? "gemini" : local.model_providers[var.ai_model]

  # Each provider's key: its secret, and the variable the backend reads it
  # from (KEY_VARIABLES in backend/src/config.ts).
  model_key = {
    gemini = { secret = "dashgen/gemini-api-key", env = "GEMINI_API_KEY", label = "Gemini" }
    claude = { secret = "dashgen/anthropic-api-key", env = "ANTHROPIC_API_KEY", label = "Claude" }
  }[local.model_provider]
}

# Keep the existing secret and its current version when upgrading a Gemini session.
moved {
  from = aws_secretsmanager_secret.gemini_api_key
  to   = aws_secretsmanager_secret.model_api_key
}

moved {
  from = aws_secretsmanager_secret_version.gemini_api_key
  to   = aws_secretsmanager_secret_version.model_api_key
}

# The model's key, and no other, so the backend never gets a key it doesn't
# use, even when the shell has both. make aws-up passes it from the shell, and
# Terraform hands it on to AWS without keeping a copy: a write-only argument.
# The secret costs $0.40 a month, charged by the hour, so $0.0005 an hour.
resource "aws_secretsmanager_secret" "model_api_key" {
  # The name changes with the provider. Switch providers between sessions so
  # ECS can still start the previous task definition during a rollback.
  name        = local.model_key.secret
  description = "DashGen's ${local.model_key.label} API key, for the backend"

  # make aws-down deletes it at once, so the next session can make it again
  # under the same name. Otherwise the name stays taken for 7 to 30 days.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "model_api_key" {
  secret_id = aws_secretsmanager_secret.model_api_key.id

  # A plan without the key, like make aws-down's or terraform-reviewer's, gets
  # a placeholder, since the provider needs a value here even then. A plan
  # never sends it, and make aws-up refuses to run without the real key.
  secret_string_wo = coalesce(local.model_provider == "claude" ? var.anthropic_api_key : var.gemini_api_key, "no-key-given")

  # Each session writes its key when it creates the secret. Sending it again
  # during that session would require changing this version.
  secret_string_wo_version = 1
}

# The secret key of DashGen's Cloudflare Turnstile widget, which the backend
# sends to Cloudflare to check each question's token (ADR-0021). Like the
# model's key: make aws-up passes it from the shell, write-only, and make
# aws-down deletes it at once. $0.40 a month, charged by the hour.
resource "aws_secretsmanager_secret" "turnstile_secret_key" {
  name                    = "dashgen/turnstile-secret-key"
  description             = "DashGen's Cloudflare Turnstile secret key, for the backend"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "turnstile_secret_key" {
  secret_id = aws_secretsmanager_secret.turnstile_secret_key.id

  # A placeholder for a plan without the key, as for the model's key.
  secret_string_wo         = coalesce(var.turnstile_secret_key, "no-key-given")
  secret_string_wo_version = 1
}

# What ECS can pass to the backend's containers, by environment variable: the
# model's key, Turnstile's secret key, and the password from RDS's own secret
# (database.tf) as PGPASSWORD, which node-postgres reads when DATABASE_URL has
# no password (ADR-0015). Each task definition takes only the ones it needs
# (ecs.tf).
locals {
  secret_env = {
    (local.model_key.env) = aws_secretsmanager_secret.model_api_key.arn
    TURNSTILE_SECRET_KEY  = aws_secretsmanager_secret.turnstile_secret_key.arn
    PGPASSWORD            = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::"
  }
}

# The role ECS takes to start the backend's tasks. Here it may read these three
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
        aws_secretsmanager_secret.model_api_key.arn,
        aws_secretsmanager_secret.turnstile_secret_key.arn,
        aws_db_instance.main.master_user_secret[0].secret_arn,
      ]
    }]
  })
}
