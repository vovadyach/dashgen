# ECS runs the backend's image on Fargate (docs/design.md#on-aws). So far it
# runs one task: the migrations and the seed, which make aws-migrate starts,
# and which stops when it's done. The cluster itself is free.

resource "aws_ecs_cluster" "main" {
  name = "dashgen"
}

# The task's output, kept for a day. make aws-down deletes it with the stack.
resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/dashgen/migrate"
  retention_in_days = 1
}

# On AWS, DATABASE_URL holds no password: ECS passes it as PGPASSWORD
# (ADR-0015). verify-full checks the database's certificate against RDS's
# bundle in the image, and the host name in it.
locals {
  database_url = join("", [
    "postgres://${aws_db_instance.main.username}@${aws_db_instance.main.address}",
    ":${aws_db_instance.main.port}/${aws_db_instance.main.db_name}",
    "?sslmode=verify-full&sslrootcert=/app/backend/certs/rds-us-east-1-bundle.pem",
  ])
}

# The migrations, then the seed, as compose.yaml's migrate service runs them
# locally. 0.25 vCPU and 0.5 GB, Fargate's smallest, on ARM: $0.0099 an hour,
# 20% less than on x86, for the minute or so it runs.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "dashgen-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.backend.repository_url}:latest"
    essential = true
    command   = ["sh", "-c", "node src/scripts/migrate.ts && node src/scripts/seed.ts"]

    environment = [{ name = "DATABASE_URL", value = local.database_url }]
    # Only the database's password: the migrations need no Gemini key.
    secrets = [{ name = "PGPASSWORD", valueFrom = local.secret_env.PGPASSWORD }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrate.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

# What else the execution role (secrets.tf) needs to start the task: pull the
# image from this repository, and write to the task's log group.
resource "aws_iam_role_policy" "task_execution_image_and_logs" {
  name = "pull-the-image-and-write-logs"
  role = aws_iam_role.task_execution.id

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
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = aws_ecr_repository.backend.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.migrate.arn}:*"
      },
    ]
  })
}
