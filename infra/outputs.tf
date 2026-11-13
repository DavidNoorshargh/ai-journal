output "aws_region" {
  description = "Region this stack is configured for."
  value       = var.aws_region
}

output "project_name" {
  description = "Project name used in resource names."
  value       = var.project_name
}

output "entries_bucket" {
  description = "Bucket for entries/{id}.md and the metadata sidecar. The deploy role cannot read these objects."
  value       = aws_s3_bucket.entries.bucket
}

output "knowledge_base_id" {
  description = "Bedrock Knowledge Base that indexes the entries prefix."
  value       = aws_bedrockagent_knowledge_base.journal.id
}

output "knowledge_base_data_source_id" {
  description = "S3 data source for the entries prefix. The ingestion Lambda starts the sync."
  value       = aws_bedrockagent_data_source.entries.data_source_id
}

output "user_pool_id" {
  description = "Cognito user pool for the single journal user. Sign-up is disabled."
  value       = aws_cognito_user_pool.journal.id
}

output "user_pool_client_id" {
  description = "Public app client for email and password sign-in."
  value       = aws_cognito_user_pool_client.journal.id
}

output "identity_pool_id" {
  description = "Identity pool that exchanges the user pool token for the entries write role."
  value       = aws_cognito_identity_pool.journal.id
}

output "journal_user_email" {
  description = "Email of the single journal user."
  value       = var.journal_user_email
}

output "agent_runtime_arn" {
  description = "AgentCore runtime that answers a question from the journal."
  value       = aws_bedrockagentcore_agent_runtime.journal.agent_runtime_arn
}
