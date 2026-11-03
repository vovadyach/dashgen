# The daily cap's count: an item per UTC day, with the questions it used
# (backend/src/cap/). It must outlive every session, so it's in this stack.
resource "aws_dynamodb_table" "daily_cap" {
  # The table's name and key, as the backend uses them.
  name     = "dashgen-daily-cap"
  hash_key = "day"

  # Paid per request: a fraction of a cent a month at 150 writes a day. The
  # default, PROVISIONED, pays for capacity every hour, used or not.
  billing_mode = "PAY_PER_REQUEST"

  # Only the key gets a type: S, a string, like "2026-11-03". The items' other
  # attributes, used and expires_at, need none.
  attribute {
    name = "day"
    type = "S"
  }

  # TTL: DynamoDB deletes each day's item for free, some time after its
  # expires_at, which the backend sets 30 days ahead.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  # A new name or key would replace the table, and lose today's count.
  lifecycle {
    prevent_destroy = true
  }
}
