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
