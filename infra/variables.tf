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
