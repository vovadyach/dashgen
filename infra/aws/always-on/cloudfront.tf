# The front door: the only address visitors use (ADR-0003). It serves the page
# from S3, and /api/* through the function in api.tf.
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

  # A stand-in for the session's load balancer. The function either answers
  # /api/* itself or points the request at the load balancer, so CloudFront
  # never connects here. If it ever did, our private bucket would answer 403.
  origin {
    origin_id   = "api"
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name

    # One attempt of 2 seconds, instead of 3 attempts of 10 (ADR-0003).
    connection_attempts = 1
    connection_timeout  = 2

    # Plain HTTP: without a domain, the load balancer has no certificate
    # (ADR-0003). The 30-second read timeout outlasts the backend's own 25.
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
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

  # /api/* caches nothing and allows POST (ADR-0003). HTTPS only, with no
  # redirect, because a redirect would turn a POST into a GET.
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api.arn
    }
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
