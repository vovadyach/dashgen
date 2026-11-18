# What the session stack needs from the shell that runs it. Nothing here is
# saved: an ephemeral variable never reaches Terraform's state or plan files.

# From TF_VAR_gemini_api_key. Only make aws-up needs it, and stops when it's
# missing; a plan, or make aws-down, works without it.
variable "gemini_api_key" {
  description = "DashGen's Gemini API key, for the backend's secret."
  type        = string
  default     = null
  ephemeral   = true
  sensitive   = true
}
