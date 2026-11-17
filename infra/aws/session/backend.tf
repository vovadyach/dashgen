# Where this stack keeps its state: under its own key, in the bucket that
# infra/aws/account makes. Its name comes from infra/aws/backend.hcl.
terraform {
  backend "s3" {
    key    = "session/terraform.tfstate"
    region = "us-east-1"

    # The lock sits next to this key's state, so this stack never waits for
    # the other two.
    use_lockfile = true
  }
}
