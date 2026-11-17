# The AWS provider, and the tags it puts on everything it makes. This stack
# is up only while DashGen is being worked on: make aws-up applies it, and
# make aws-down destroys it (docs/runbooks/deploy.md#the-session-stack).
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      ManagedBy = "terraform"
      Project   = "dashgen"
      Stack     = "session"
    }
  }
}
