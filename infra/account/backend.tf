# Where this stack keeps its state: in the bucket from state.tf. A backend can't
# use variables, so the bucket's name, which holds the account ID, comes from
# infra/backend.hcl, which git ignores (see infra/backend.hcl.example).
terraform {
  backend "s3" {
    key    = "account/terraform.tfstate"
    region = "us-east-1"

    # While a plan or apply runs, a lock file sits next to the state, so a
    # second run stops instead of writing the state at the same time.
    use_lockfile = true
  }
}
