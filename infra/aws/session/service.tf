# The backend's service on ECS (docs/design.md#on-aws): exactly one task of the
# backend's image, behind the load balancer. The per-IP rate limit and the
# events of runs in progress live in its memory, so a second task would split
# them. The task costs $0.0099 an hour on ARM, while it runs.

# The daily cap's table, in the always-on stack.
data "aws_dynamodb_table" "daily_cap" {
  name = "dashgen-daily-cap"
}

# CloudFront's distribution, in the always-on stack, found by its tags. Its
# address is the backend's one allowed origin for CORS.
data "aws_resourcegroupstaggingapi_resources" "front_door" {
  resource_type_filters = ["cloudfront:distribution"]

  tag_filter {
    key    = "Project"
    values = ["dashgen"]
  }
  tag_filter {
    key    = "Stack"
    values = ["always-on"]
  }
}

data "aws_cloudfront_distribution" "front_door" {
  # one() stops the plan unless exactly one distribution has these tags.
  id = element(split("/", one(data.aws_resourcegroupstaggingapi_resources.front_door.resource_tag_mapping_list).resource_arn), 1)
}

# The backend's output, kept for a day. make aws-down deletes it with the stack.
resource "aws_cloudwatch_log_group" "backend" {
  name              = "/dashgen/backend"
  retention_in_days = 1
}

# The task role: what the backend itself may do on AWS. Only count the day's
# questions in the daily cap's table, which takes one UpdateItem a question.
resource "aws_iam_role" "backend" {
  name        = "dashgen-backend"
  description = "The backend's own access to AWS: the daily cap's table"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "backend" {
  name = "count-the-daily-cap"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "dynamodb:UpdateItem"
      Resource = data.aws_dynamodb_table.daily_cap.arn
    }]
  })
}

# The image's own command, node src/server.ts, on port 3000. 0.25 vCPU and
# 0.5 GB on ARM, like the migrations task. A template, like the migrations
# task's (ecs.tf): each deploy copies its newest revision into
# dashgen-backend, pinned to one image.
resource "aws_ecs_task_definition" "backend" {
  family                   = "dashgen-backend-template"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.backend.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name         = "backend"
    image        = "${data.aws_ecr_repository.backend.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = concat([
      { name = "DATABASE_URL", value = local.database_url },
      # AWS's own DynamoDB, with this task's role (backend/src/config.ts).
      { name = "DYNAMODB_REGION", value = data.aws_region.current.region },
      { name = "ALLOWED_ORIGINS", value = "https://${data.aws_cloudfront_distribution.front_door.domain_name}" },
      # The visitor's IP, which CloudFront's function sends, for the rate
      # limit (ADR-0003).
      { name = "VIEWER_IP_HEADER", value = "x-viewer-ip" },
      ],
      # The model TF_VAR_ai_model names; without one, the backend's default.
      var.ai_model == null ? [] : [{ name = "AI_MODEL", value = var.ai_model }],
    )
    # Its secrets: the model's key, Turnstile's secret key, and the
    # database's password (secrets.tf).
    secrets = [for name, from in local.secret_env : { name = name, valueFrom = from }]

    # On a stop, ECS sends SIGTERM, then waits this long before it kills the
    # task: longer than a run's 25 seconds, so runs in progress finish.
    stopTimeout = 30

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "backend"
      }
    }
  }])

  # Write the key before ECS can start a task that reads it.
  depends_on = [aws_secretsmanager_secret_version.model_api_key]
}

resource "aws_ecs_service" "backend" {
  name            = "dashgen-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  launch_type     = "FARGATE"

  # No task yet: the image and the migrations come after Terraform, then
  # scripts/aws-start.sh asks for one. ignore_changes keeps that one at later
  # plans.
  desired_count = 0

  # A deploy stops the old task before it starts the new one, so there are
  # never two: about a minute without a backend.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  # A deploy that keeps failing stops, and goes back to the last one that
  # worked, instead of retrying for the rest of the session.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # The load balancer's health checks count only after a task's first 30
  # seconds.
  health_check_grace_period_seconds = 30

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.backend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 3000
  }

  lifecycle {
    # The deploy owns both once the service exists. desired_count:
    # scripts/aws-start.sh asks for one task. task_definition: each deploy
    # registers a copy of this stack's definition pinned to one image's
    # digest, and runs the migrations and the backend on it
    # (scripts/aws-session.sh), so an apply never restarts the backend on an
    # image that isn't built or migrated yet.
    ignore_changes = [desired_count, task_definition]
  }

  # A target group takes a service only once a listener sends to it.
  depends_on = [aws_lb_listener_rule.from_cloudfront]
}
