# Where the backend's image lives on AWS (backend/Dockerfile): make aws-image
# builds it and pushes it here. Like everything that can be rebuilt, it's in
# the session stack, so make aws-down deletes the repository with its images,
# and each session pushes the image again. Storage costs $0.10 a GB a month,
# about a cent a month for this image, charged by the hour.
resource "aws_ecr_repository" "backend" {
  name = "dashgen-backend"

  # make aws-image tags each image with its commit, and as latest, which the
  # task definitions use, so latest moves.
  image_tag_mutability = "MUTABLE"

  # Deleted with its images, so make aws-down finishes cleanly.
  force_delete = true

  # ECR's basic scan for known vulnerabilities, free, on every push.
  image_scanning_configuration {
    scan_on_push = true
  }
}
