# The AWS provider: the region it works in, and the tags it puts on everything
# it makes, so anyone can see in the console what Terraform manages.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      ManagedBy = "terraform"
      Stack     = "account"
    }
  }
}
