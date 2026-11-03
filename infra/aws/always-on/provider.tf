# The AWS provider: the region it works in, and the tags it puts on everything
# it makes, so anyone can see in the console what Terraform manages. Project
# tells DashGen apart from other projects in the account; infra/aws/account
# has none, since it isn't DashGen's.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      ManagedBy = "terraform"
      Project   = "dashgen"
      Stack     = "always-on"
    }
  }
}
