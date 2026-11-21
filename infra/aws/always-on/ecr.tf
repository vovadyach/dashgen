# Where the backend's images live on AWS (backend/Dockerfile), between
# sessions too (ADR-0017). CI pushes one from each merge to main, tagged main
# and main-<commit> (scripts/ci-deploy-backend.sh), and make aws-image one
# from your own code, tagged dev and dev-<commit> (scripts/aws-image.sh).
# Storage costs $0.10 a GB a month, for images of about 86 MB: a few cents a
# month at the usual rate of a few pushes a week. What it costs depends on
# how much gets pushed.
resource "aws_ecr_repository" "backend" {
  name = "dashgen-backend"

  # main and dev move to each newer image.
  image_tag_mutability = "MUTABLE"

  # ECR's basic scan for known vulnerabilities, free, on every push.
  image_scanning_configuration {
    scan_on_push = true
  }
}

# Two rules. An image the first rule matches can't be expired by the second,
# even when the first keeps it (ECR's lifecycle rules).
#
# 1. CI's images, by count: the newest 3 stay however old they are, so a
#    session can start main's image after weeks without a merge, and ECS can
#    still go back to the one before it.
# 2. Every other image, by age: a week after its push, like your own builds.
#    A session lasts hours, and the scripts refuse a dev image over 6 days
#    old, so none expires while a session runs it.
#
# ECR applies the rules within a day of an image's turn.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep CI's newest 3 images, from main"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["main-*"]
          countType      = "imageCountMoreThan"
          countNumber    = 3
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire every other image a week after its push"
        selection = {
          tagStatus   = "any"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
    ]
  })
}
