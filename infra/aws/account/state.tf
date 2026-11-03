# The bucket for Terraform's state: every stack in this account keeps its state
# here, each under its own key.
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "terraform_state" {
  # Bucket names are unique across all of AWS. The account ID makes this one
  # unique, without writing the ID in the repo.
  bucket = "terraform-state-${data.aws_caller_identity.current.account_id}"

  # Losing the bucket would lose every stack's state.
  lifecycle {
    prevent_destroy = true
  }
}

# Every write keeps the previous version, so a broken state can be rolled back.
resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# State can hold secrets: nothing in this bucket can ever be made public.
resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
