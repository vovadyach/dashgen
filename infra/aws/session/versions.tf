# What this stack needs: Terraform itself, and the AWS provider, the plugin
# that turns this code into calls to AWS's API.
terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
  }
}
