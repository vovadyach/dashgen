# The front door: the only address visitors use (ADR-0003). For now it serves
# the page from S3. The API's /api/* comes in a later step.
resource "aws_cloudfront_distribution" "front_door" {
  enabled             = true
  comment             = "DashGen"
  default_root_object = "index.html"

  # IPv4 only, the default, kept on purpose: a home IPv6 connection usually has
  # 2^64 addresses or more, so a visitor could get past the per-IP rate limit.
  is_ipv6_enabled = false

  origin {
    origin_id   = "site"
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name

    # CloudFront signs every request to the bucket, and the bucket policy
    # (site.tf) checks the signature.
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    # CloudFront keeps each file for a day, unless S3 says otherwise, and
    # compresses what it sends, with Brotli for browsers: AG Charts' 1.3 MB
    # arrives as about 390 KB.
    cache_policy_id = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress        = true
  }

  # Visitors from every country.
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # HTTPS on CloudFront's own address, dxxxx.cloudfront.net. There's no domain,
  # so there's no certificate of our own (ADR-0003).
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # A new distribution gets a new dxxxx.cloudfront.net address, which would
  # break every link to DashGen, share links included.
  lifecycle {
    prevent_destroy = true
  }
}

# How CloudFront proves to S3 that a request comes from it: it signs each one
# with SigV4, as the AWS CLI does.
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "dashgen-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS's managed cache policy for files that rarely change.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}
