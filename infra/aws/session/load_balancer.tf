# The load balancer in front of the backend (ADR-0003). It's public, but only
# CloudFront gets through: its security group lets in only CloudFront's
# addresses (security_groups.tf), and it forwards only requests that carry this
# session's secret header, which CloudFront's function adds. Anything else
# gets 403. It costs $0.0225 an hour, plus $0.005 for each of its two public
# IPs.

# This session's secret: a random UUID, 122 random bits, made when the session
# starts. uuid() gives a new one at every plan, so ignore_changes keeps the
# first. It's in Terraform's state, never in the repo.
resource "terraform_data" "origin_secret" {
  input = sensitive(uuid())

  lifecycle {
    ignore_changes = [input]
  }
}

resource "aws_lb" "api" {
  name               = "dashgen"
  load_balancer_type = "application"
  internal           = false
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.load_balancer.id]

  # A request with a malformed header name is dropped, not passed on.
  drop_invalid_header_fields = true

  tags = { Name = "dashgen" }
}

# The backend's task, by its IP, as Fargate tasks register.
resource "aws_lb_target_group" "backend" {
  name        = "dashgen-backend"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  protocol    = "HTTP"
  port        = 3000

  # A task leaving gets 30 seconds, more than a run's 25, so runs in progress
  # finish and are saved (docs/design.md#on-aws).
  deregistration_delay = 30

  # Healthy after 2 answers in a row, 10 seconds apart; unhealthy after 3
  # misses. AWS's defaults would take 2.5 minutes to call a new task healthy.
  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Plain HTTP from CloudFront: an accepted risk that ADR-0003 explains. Without
# the secret header, a request gets 403.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  condition {
    http_header {
      http_header_name = "x-origin-verify"
      values           = [terraform_data.origin_secret.output]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}
