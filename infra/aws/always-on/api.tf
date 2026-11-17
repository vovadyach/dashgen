# The API's door, /api/* (ADR-0003): a CloudFront Function on every request,
# and a key-value store that tells it whether a session is running.

# One entry, "session", while a session runs: its load balancer's address and
# its secret. The session stack writes it and removes it, and between sessions
# the store is empty.
resource "aws_cloudfront_key_value_store" "session" {
  name    = "dashgen-session"
  comment = "The running session's load balancer and secret"
}

# The function's code is in functions/api.js.
resource "aws_cloudfront_function" "api" {
  name    = "dashgen-api"
  comment = "Sends /api/* to the running session, or answers 503 offline"
  runtime = "cloudfront-js-2.0"
  code    = file("${path.module}/functions/api.js")

  # CloudFront keeps two copies of the code: DEVELOPMENT, for tests, and LIVE,
  # which the distribution runs. Terraform publishes each change to LIVE.
  publish = true

  key_value_store_associations = [aws_cloudfront_key_value_store.session.arn]
}

# AWS's managed cache policy that caches nothing.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}
