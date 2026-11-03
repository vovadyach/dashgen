# Values that differ for each person, so they stay out of the public repo: they
# go in terraform.tfvars, which git ignores (see terraform.tfvars.example).
variable "alert_email" {
  description = "Where AWS sends the budget's alert emails."
  type        = string
}
