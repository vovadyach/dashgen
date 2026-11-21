# The backend's image repository, in the always-on stack (ADR-0017), so it and
# its images outlive each session. make aws-image pushes the image there, and
# the task definitions here pull it. Apply the always-on stack first: this
# lookup fails until the repository exists.
data "aws_ecr_repository" "backend" {
  name = "dashgen-backend"
}
