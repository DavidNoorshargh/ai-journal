output "state_bucket" {
  description = "S3 bucket for the main stack's Terraform state. Copy this into infra/backend.hcl."
  value       = aws_s3_bucket.state.bucket
}

output "lock_table" {
  description = "DynamoDB table that locks the main stack's Terraform state."
  value       = aws_dynamodb_table.lock.name
}

output "aws_region" {
  description = "Region of the state bucket and lock table."
  value       = var.aws_region
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes. It can use the state bucket and lock table."
  value       = aws_iam_role.deploy.arn
}

output "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC provider used by the deploy role."
  value       = local.github_oidc_provider_arn
}
