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
