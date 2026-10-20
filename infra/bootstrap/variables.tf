variable "aws_region" {
  description = "Region for the state bucket, lock table, and deploy role."
  type        = string
  default     = "eu-west-2"
}

variable "project_name" {
  description = "Short name used in resource names."
  type        = string
  default     = "ai-journal"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, as owner/name."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/name."
  }
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub Actions OIDC provider. Set false when this account already has one."
  type        = bool
  default     = true
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub OIDC provider ARN. Used only when create_github_oidc_provider is false."
  type        = string
  default     = ""
}
