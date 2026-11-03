output "state_bucket" {
  description = "The S3 bucket that holds Terraform's state."
  value       = aws_s3_bucket.terraform_state.bucket
}
