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

# The visitor's headers that /api/* passes on to the backend, and no others:
# Content-Type, for POST /api/ask's JSON, and Last-Event-ID, which a
# reconnecting stream sends, so it resumes where it stopped (ADR-0011). AWS's
# pages disagree on whether Content-Type gets through without this. And for
# /api/mcp, the 3 that MCP's clients send (ADR-0023): Mcp-Session-Id, which
# ties a request to its session, MCP-Protocol-Version, and Accept, which must
# take both JSON and an event stream. Origin too, which a browser sends, so
# the backend can refuse web pages, as MCP asks. Nothing else gets through,
# so a visitor's own x-origin-verify or x-viewer-ip never reaches the
# backend: the function sets those two.
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "dashgen-api"
  comment = "The visitor headers that /api/* passes on to the backend"

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["accept", "content-type", "last-event-id", "mcp-protocol-version", "mcp-session-id", "origin"]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}
