output "site_bucket" {
  description = "The S3 bucket for the page's build, for aws s3 sync."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "The CloudFront distribution's ID, for cache invalidations."
  value       = aws_cloudfront_distribution.front_door.id
}

output "session_store_arn" {
  description = "The key-value store's ARN, for the session's entry."
  value       = aws_cloudfront_key_value_store.session.arn
}

output "url" {
  description = "DashGen's public address."
  value       = "https://${aws_cloudfront_distribution.front_door.domain_name}"
}
