output "site_bucket" {
  description = "The S3 bucket for the page's build, for aws s3 sync."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "The CloudFront distribution's ID, for cache invalidations."
  value       = aws_cloudfront_distribution.front_door.id
}

output "url" {
  description = "DashGen's public address."
  value       = "https://${aws_cloudfront_distribution.front_door.domain_name}"
}
