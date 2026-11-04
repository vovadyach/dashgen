# The page: Vite's build of frontend/, in a private bucket that only our
# CloudFront distribution can read (cloudfront.tf).
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "site" {
  # Unique across all of AWS thanks to the account ID, as in infra/aws/account.
  bucket = "dashgen-site-${data.aws_caller_identity.current.account_id}"
}

# Nothing in this bucket can be made public: visitors reach it only through
# CloudFront.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# The bucket's one reader: CloudFront, and only for our distribution. Any other
# distribution, in any account, gets 403.
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.front_door.arn
        }
      }
    }]
  })
}
