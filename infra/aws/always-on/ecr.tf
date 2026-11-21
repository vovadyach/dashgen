# Where the backend's image lives on AWS (backend/Dockerfile), between sessions
# too (ADR-0017): make aws-image pushes it here, and the session stack's tasks
# pull it. Storage costs $0.10 a GB a month, and the rule below keeps each
# image of about 86 MB for a week: a few cents a month at the usual rate of a
# few pushes a week. What it costs depends on how much gets pushed.
resource "aws_ecr_repository" "backend" {
  name = "dashgen-backend"

  # make aws-image tags each image with its commit, and as latest, which the
  # task definitions use, so latest moves.
  image_tag_mutability = "MUTABLE"

  # ECR's basic scan for known vulnerabilities, free, on every push.
  image_scanning_configuration {
    scan_on_push = true
  }
}

# Expires each image a week after its push, by age, not by count. A rule by
# count could expire the image ECS still runs, after a few newer builds failed
# to deploy, and a replacement task couldn't pull it. A session lasts hours, so
# no image pushed in it expires while it runs. ECR applies the rule within a
# day of an image's turn.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images a week after their push"
      selection = {
        tagStatus   = "any"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 7
      }
      action = { type = "expire" }
    }]
  })
}
