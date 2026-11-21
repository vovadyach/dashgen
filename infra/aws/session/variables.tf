# What the session stack needs from the shell that runs it. The keys are never
# saved: an ephemeral variable never reaches Terraform's state or plan files.
# ai_model isn't a secret, so Terraform saves it like any other setting.

# From TF_VAR_gemini_api_key, for a Gemini model, the default. Only make aws-up
# needs it, and stops when it's missing; a plan, or make aws-down, works
# without it.
variable "gemini_api_key" {
  description = "DashGen's Gemini API key, for the backend's secret."
  type        = string
  default     = null
  ephemeral   = true
  sensitive   = true
}

# From TF_VAR_anthropic_api_key, for a Claude model: make aws-up needs it, in
# place of the Gemini key, when TF_VAR_ai_model names one.
variable "anthropic_api_key" {
  description = "DashGen's Claude API key, for the backend's secret."
  type        = string
  default     = null
  ephemeral   = true
  sensitive   = true
}

# From TF_VAR_ai_model: the backend's AI_MODEL, like claude-haiku-5-5. Unset,
# the backend runs its own default, a Gemini model (backend/src/config.ts).
variable "ai_model" {
  description = "The model the backend runs on, or null for its default."
  type        = string
  default     = null

  # Checked at the plan, so a typo stops before anything is made. The backend
  # checks too, but only once its task starts, with the whole stack up.
  validation {
    condition     = var.ai_model == null || contains(keys(local.model_providers), var.ai_model)
    error_message = "TF_VAR_ai_model must name a model DashGen has: ${join(", ", keys(local.model_providers))}."
  }
}

# From TF_VAR_image_tag: which of the backend's images the session runs
# (ADR-0017). main, the default, is CI's, built from each merge to main, so
# make aws-up builds nothing. dev is your own code's, which make aws-image
# builds, to try a branch.
variable "image_tag" {
  description = "The backend's image the session runs: main, from CI, or dev, from make aws-image."
  type        = string
  default     = "main"

  validation {
    condition     = contains(["main", "dev"], var.image_tag)
    error_message = "TF_VAR_image_tag must be main, CI's image, or dev, your own code's."
  }
}
