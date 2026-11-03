# Where this stack keeps its state: under its own key, in the bucket that
# infra/aws/account makes. Its name comes from infra/aws/backend.hcl.
terraform {
  backend "s3" {
    key    = "always-on/terraform.tfstate"
    region = "us-east-1"

    # The lock sits next to this key's state, so this stack and
    # infra/aws/account never wait for each other.
    use_lockfile = true
  }
}
