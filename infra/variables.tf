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
  description = "Email of the single journal user. Sign-up stays disabled. This address is not a secret."
  type        = string
  default     = "journal@example.com"
}
