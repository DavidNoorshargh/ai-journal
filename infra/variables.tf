variable "aws_region" {
  description = "Region for the whole stack. Prefer eu-west-2 when AgentCore, Knowledge Bases, and S3 Vectors are all available there."
  type        = string
  default     = "eu-west-2"
}

variable "project_name" {
  description = "Short name used in resource names."
  type        = string
  default     = "ai-journal"
}

variable "agent_source_sha" {
  description = "Commit SHA used in the agent zip object key. The workflow sets this. The zip itself is not committed."
  type        = string
  default     = "local"
}

variable "journal_user_email" {
  description = "Email of the single journal user (Cognito username) and the Faithfulness SNS inbox. Sign-up stays disabled. Not a secret."
  type        = string
  default     = "davidn1478@gmail.com"

  validation {
    condition     = var.journal_user_email != "" && !endswith(var.journal_user_email, "@example.com")
    error_message = "Set journal_user_email to a real inbox (TF_VAR_journal_user_email or terraform.tfvars). @example.com cannot receive SNS mail."
  }
}

variable "faithfulness_alarm_threshold" {
  description = "Alarm when the production Builtin.Faithfulness average falls below this (0–1). Provisional until the gate threshold is chosen."
  type        = number
  default     = 0.5
}
