# One deploy at a time, CI's or make aws-deploy's (ADR-0017): a deploy holds
# the one item here from choosing its image to the backend's update
# (lock_deploys in scripts/aws-session.sh). Two deploys can't interleave, so
# an older image never lands after a newer one, and CI never puts main back
# while make deploys dev. It goes with the session, so a lock that a stopped
# deploy left goes too, and each lock expires after 30 minutes anyway. On
# demand, it costs a fraction of a cent: a few writes per deploy.
resource "aws_dynamodb_table" "deploy_lock" {
  name         = "dashgen-deploy-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "lock"

  attribute {
    name = "lock"
    type = "S"
  }
}
