data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_bucket.json
}

resource "aws_dynamodb_table" "lock" {
  name         = "${var.project_name}-tf-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.github_oidc_provider_arn
  github_oidc_host         = "token.actions.githubusercontent.com"
  github_owner             = split("/", var.github_repository)[0]
  github_name              = split("/", var.github_repository)[1]
  github_subject_prefix    = "repo:${local.github_owner}@${var.github_owner_id}/${local.github_name}@${var.github_repository_id}"
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "${local.github_oidc_host}:sub"
      values = [
        "${local.github_subject_prefix}:ref:refs/heads/main",
        "${local.github_subject_prefix}:environment:production",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.project_name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
  description        = "Assumed by GitHub Actions for this repository. Stack permissions are added with later infrastructure steps."

  lifecycle {
    precondition {
      condition     = var.create_github_oidc_provider || length(var.github_oidc_provider_arn) > 0
      error_message = "Set github_oidc_provider_arn when create_github_oidc_provider is false."
    }
  }
}

data "aws_iam_policy_document" "deploy_state" {
  statement {
    sid    = "StateList"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketVersioning",
    ]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    sid    = "StateObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }

  statement {
    sid    = "StateLock"
    effect = "Allow"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.lock.arn]
  }
}

resource "aws_iam_role_policy" "deploy_state" {
  name   = "${var.project_name}-terraform-state"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_state.json
}

data "aws_iam_policy_document" "deploy_entries" {
  statement {
    sid    = "EntryBucketManage"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:ListBucket",
      "s3:GetBucket*",
      "s3:PutBucket*",
      "s3:DeleteBucketPolicy",
      "s3:GetEncryptionConfiguration",
      "s3:PutEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:GetAccelerateConfiguration",
    ]
    resources = [
      "arn:aws:s3:::${var.project_name}-entries-${data.aws_caller_identity.current.account_id}",
    ]
  }
}

resource "aws_iam_role_policy" "deploy_entries" {
  name   = "${var.project_name}-entries-bucket"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_entries.json
}

data "aws_iam_policy_document" "deploy_knowledge" {
  statement {
    sid    = "KnowledgeBaseRole"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-knowledge-base"]
  }

  statement {
    sid       = "PassKnowledgeBaseRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-knowledge-base"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["bedrock.amazonaws.com"]
    }
  }

  statement {
    sid    = "VectorBucket"
    effect = "Allow"
    actions = [
      "s3vectors:CreateVectorBucket",
      "s3vectors:GetVectorBucket",
      "s3vectors:DeleteVectorBucket",
      "s3vectors:CreateIndex",
      "s3vectors:GetIndex",
      "s3vectors:DeleteIndex",
      "s3vectors:ListIndexes",
      "s3vectors:TagResource",
      "s3vectors:UntagResource",
      "s3vectors:ListTagsForResource",
    ]
    resources = [
      "arn:aws:s3vectors:${var.aws_region}:${data.aws_caller_identity.current.account_id}:bucket/${var.project_name}-vectors-${data.aws_caller_identity.current.account_id}",
      "arn:aws:s3vectors:${var.aws_region}:${data.aws_caller_identity.current.account_id}:bucket/${var.project_name}-vectors-${data.aws_caller_identity.current.account_id}/index/*",
    ]
  }

  statement {
    sid    = "KnowledgeBase"
    effect = "Allow"
    actions = [
      "bedrock:CreateKnowledgeBase",
      "bedrock:GetKnowledgeBase",
      "bedrock:UpdateKnowledgeBase",
      "bedrock:DeleteKnowledgeBase",
      "bedrock:CreateDataSource",
      "bedrock:GetDataSource",
      "bedrock:UpdateDataSource",
      "bedrock:DeleteDataSource",
      "bedrock:ListDataSources",
      "bedrock:TagResource",
      "bedrock:UntagResource",
      "bedrock:ListTagsForResource",
    ]
    resources = ["arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*"]
  }
}

resource "aws_iam_role_policy" "deploy_knowledge" {
  name   = "${var.project_name}-knowledge-base"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_knowledge.json
}

data "aws_iam_policy_document" "deploy_ingestion" {
  statement {
    sid    = "IngestionRole"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-ingestion"]
  }

  statement {
    sid       = "PassIngestionRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-ingestion"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid    = "IngestionQueues"
    effect = "Allow"
    actions = [
      "sqs:CreateQueue",
      "sqs:DeleteQueue",
      "sqs:GetQueueAttributes",
      "sqs:SetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:TagQueue",
      "sqs:UntagQueue",
      "sqs:ListQueueTags",
    ]
    resources = [
      "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${var.project_name}-ingestion",
      "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${var.project_name}-ingestion-dlq",
    ]
  }

  statement {
    sid    = "IngestionFunction"
    effect = "Allow"
    actions = [
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:GetPolicy",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:ListVersionsByFunction",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:ListTags",
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-ingestion"]
  }

  statement {
    sid    = "IngestionMapping"
    effect = "Allow"
    actions = [
      "lambda:CreateEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:UpdateEventSourceMapping",
      "lambda:DeleteEventSourceMapping",
      "lambda:ListEventSourceMappings",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:ListTags",
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:event-source-mapping:*"]
  }

  statement {
    sid    = "IngestionLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:ListTagsForResource",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-ingestion",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-ingestion:*",
    ]
  }

  # DescribeLogGroups is how Terraform refreshes a log group, and the API
  # call is not scoped to the group name. It returns names, not log events.
  statement {
    sid       = "DescribeLogGroups"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

}

resource "aws_iam_role_policy" "deploy_ingestion" {
  name   = "${var.project_name}-ingestion"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_ingestion.json
}

data "aws_iam_policy_document" "deploy_auth" {
  statement {
    sid       = "CreateUserPool"
    effect    = "Allow"
    actions   = ["cognito-idp:CreateUserPool"]
    resources = ["*"]
  }

  statement {
    sid    = "UserPool"
    effect = "Allow"
    actions = [
      "cognito-idp:DeleteUserPool",
      "cognito-idp:DescribeUserPool",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:UpdateUserPoolClient",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:ListUserPoolClients",
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:ListUsers",
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:SetUserPoolMfaConfig",
      "cognito-idp:TagResource",
      "cognito-idp:UntagResource",
      "cognito-idp:ListTagsForResource",
    ]
    resources = ["arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"]
  }

  statement {
    sid       = "CreateIdentityPool"
    effect    = "Allow"
    actions   = ["cognito-identity:CreateIdentityPool"]
    resources = ["*"]
  }

  statement {
    sid    = "IdentityPool"
    effect = "Allow"
    actions = [
      "cognito-identity:DeleteIdentityPool",
      "cognito-identity:DescribeIdentityPool",
      "cognito-identity:UpdateIdentityPool",
      "cognito-identity:GetIdentityPoolRoles",
      "cognito-identity:SetIdentityPoolRoles",
      "cognito-identity:TagResource",
      "cognito-identity:UntagResource",
      "cognito-identity:ListTagsForResource",
    ]
    resources = ["arn:aws:cognito-identity:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identitypool/*"]
  }

  statement {
    sid    = "EntriesWriteRole"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-entries-write"]
  }

  # SetIdentityPoolRoles checks iam:PassRole and does not set iam:PassedToService,
  # so a condition on that key never matches. The role trust policy is what
  # limits assumption to this identity pool.
  statement {
    sid       = "PassEntriesWriteRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-entries-write"]
  }
}

resource "aws_iam_role_policy" "deploy_auth" {
  name   = "${var.project_name}-auth"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_auth.json
}

data "aws_iam_policy_document" "deploy_agent" {
  statement {
    sid    = "ArtifactBucket"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:ListBucket",
      "s3:GetBucket*",
      "s3:PutBucket*",
      "s3:DeleteBucketPolicy",
      "s3:GetEncryptionConfiguration",
      "s3:PutEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:GetAccelerateConfiguration",
    ]
    resources = ["arn:aws:s3:::${var.project_name}-artifacts-${data.aws_caller_identity.current.account_id}"]
  }

  statement {
    sid    = "ArtifactObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObjectTagging",
      "s3:PutObjectTagging",
      "s3:GetObjectAttributes",
      "s3:AbortMultipartUpload",
    ]
    resources = ["arn:aws:s3:::${var.project_name}-artifacts-${data.aws_caller_identity.current.account_id}/agent/*"]
  }

  statement {
    sid    = "AgentRole"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-agent"]
  }

  statement {
    sid       = "PassAgentRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-agent"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["bedrock-agentcore.amazonaws.com"]
    }
  }

  statement {
    sid       = "CreateRuntime"
    effect    = "Allow"
    actions   = ["bedrock-agentcore:CreateAgentRuntime"]
    resources = ["*"]
  }

  statement {
    sid    = "Runtime"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetAgentRuntime",
      "bedrock-agentcore:UpdateAgentRuntime",
      "bedrock-agentcore:DeleteAgentRuntime",
      "bedrock-agentcore:ListAgentRuntimes",
      "bedrock-agentcore:CreateAgentRuntimeEndpoint",
      "bedrock-agentcore:GetAgentRuntimeEndpoint",
      "bedrock-agentcore:UpdateAgentRuntimeEndpoint",
      "bedrock-agentcore:DeleteAgentRuntimeEndpoint",
      "bedrock-agentcore:ListAgentRuntimeEndpoints",
    ]
    resources = ["arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:runtime/*"]
  }

  # CreateAgentRuntime creates a workload identity in the default directory.
  statement {
    sid    = "WorkloadIdentity"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:CreateWorkloadIdentity",
      "bedrock-agentcore:GetWorkloadIdentity",
      "bedrock-agentcore:UpdateWorkloadIdentity",
      "bedrock-agentcore:DeleteWorkloadIdentity",
      "bedrock-agentcore:ListWorkloadIdentities",
    ]
    resources = ["arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:workload-identity-directory/*"]
  }

  # CreateAgentRuntime tags the workload identity as well as the runtime.
  statement {
    sid    = "TagAgentCore"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:TagResource",
      "bedrock-agentcore:UntagResource",
      "bedrock-agentcore:ListTagsForResource",
    ]
    resources = ["arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }

  statement {
    sid       = "CreateRuntimeIdentityRole"
    effect    = "Allow"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/runtime-identity.bedrock-agentcore.amazonaws.com/AWSServiceRoleForBedrockAgentCoreRuntimeIdentity"]

    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["runtime-identity.bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "deploy_agent" {
  name   = "${var.project_name}-agent"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_agent.json
}

data "aws_iam_policy_document" "deploy_observability" {
  statement {
    sid    = "RuntimeLogGroups"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:DeleteRetentionPolicy",
      "logs:AssociateKmsKey",
      "logs:DisassociateKmsKey",
      "logs:TagResource",
      "logs:UntagResource",
      "logs:ListTagsForResource",
      "logs:DescribeLogGroups",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:*",
    ]
  }

  statement {
    sid    = "TransactionSearchPolicy"
    effect = "Allow"
    actions = [
      "logs:PutResourcePolicy",
      "logs:DeleteResourcePolicy",
      "logs:DescribeResourcePolicies",
    ]
    resources = ["*"]
  }

  # UpdateTraceSegmentDestination creates these groups and their streams.
  statement {
    sid    = "TransactionSearchLogGroups"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:PutRetentionPolicy",
      "logs:DeleteRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
      "logs:ListTagsForResource",
      "logs:DescribeLogGroups",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:aws/spans",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:aws/spans:*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/application-signals/data",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/application-signals/data:*",
    ]
  }

  # Official Enable Transaction Search prerequisites (AWS docs).
  statement {
    sid    = "TraceDestination"
    effect = "Allow"
    actions = [
      "xray:GetTraceSegmentDestination",
      "xray:UpdateTraceSegmentDestination",
      "xray:GetIndexingRules",
      "xray:UpdateIndexingRule",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ApplicationSignalsDiscovery"
    effect    = "Allow"
    actions   = ["application-signals:StartDiscovery"]
    resources = ["*"]
  }

  statement {
    sid       = "ApplicationSignalsServiceLinkedRole"
    effect    = "Allow"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/application-signals.cloudwatch.amazonaws.com/AWSServiceRoleForCloudWatchApplicationSignals"]

    condition {
      test     = "StringLike"
      variable = "iam:AWSServiceName"
      values   = ["application-signals.cloudwatch.amazonaws.com"]
    }
  }

  statement {
    sid       = "ApplicationSignalsGetRole"
    effect    = "Allow"
    actions   = ["iam:GetRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/application-signals.cloudwatch.amazonaws.com/AWSServiceRoleForCloudWatchApplicationSignals"]
  }

  statement {
    sid     = "ApplicationSignalsCloudTrailChannel"
    effect  = "Allow"
    actions = ["cloudtrail:CreateServiceLinkedChannel"]
    # AWS docs use region *; StartDiscovery may create the channel outside eu-west-2.
    resources = ["arn:aws:cloudtrail:*:${data.aws_caller_identity.current.account_id}:channel/aws-service-channel/application-signals/*"]
  }

  statement {
    sid    = "LogsKey"
    effect = "Allow"
    actions = [
      "kms:CreateKey",
      "kms:DescribeKey",
      "kms:GetKeyPolicy",
      "kms:PutKeyPolicy",
      "kms:EnableKeyRotation",
      "kms:GetKeyRotationStatus",
      "kms:ScheduleKeyDeletion",
      "kms:CancelKeyDeletion",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:ListResourceTags",
      "kms:CreateAlias",
      "kms:UpdateAlias",
      "kms:DeleteAlias",
      "kms:ListAliases",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "TrailBucket"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:ListBucket",
      "s3:GetBucket*",
      "s3:PutBucket*",
      "s3:DeleteBucketPolicy",
      "s3:GetEncryptionConfiguration",
      "s3:PutEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:GetAccelerateConfiguration",
    ]
    resources = ["arn:aws:s3:::${var.project_name}-cloudtrail-${data.aws_caller_identity.current.account_id}"]
  }

  statement {
    sid    = "TrailObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObjectTagging",
      "s3:PutObjectTagging",
      "s3:GetObjectAttributes",
      "s3:AbortMultipartUpload",
    ]
    resources = ["arn:aws:s3:::${var.project_name}-cloudtrail-${data.aws_caller_identity.current.account_id}/*"]
  }

  statement {
    sid    = "Trail"
    effect = "Allow"
    actions = [
      "cloudtrail:CreateTrail",
      "cloudtrail:DeleteTrail",
      "cloudtrail:UpdateTrail",
      "cloudtrail:GetTrail",
      "cloudtrail:GetTrailStatus",
      "cloudtrail:StartLogging",
      "cloudtrail:StopLogging",
      "cloudtrail:PutEventSelectors",
      "cloudtrail:GetEventSelectors",
      "cloudtrail:AddTags",
      "cloudtrail:RemoveTags",
      "cloudtrail:ListTags",
    ]
    resources = ["arn:aws:cloudtrail:${var.aws_region}:${data.aws_caller_identity.current.account_id}:trail/${var.project_name}"]
  }

  # DescribeTrails does not accept a trail ARN.
  statement {
    sid       = "DescribeTrails"
    effect    = "Allow"
    actions   = ["cloudtrail:DescribeTrails"]
    resources = ["*"]
  }
}

# Inline policies on the deploy role are already near the 10KB IAM limit, so
# this one is a managed policy attached to the role.
resource "aws_iam_policy" "deploy_observability" {
  name        = "${var.project_name}-observability"
  description = "Lets the deploy role manage Transaction Search, runtime log groups, the logs key, and the CloudTrail trail."
  policy      = data.aws_iam_policy_document.deploy_observability.json
}

resource "aws_iam_role_policy_attachment" "deploy_observability" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_observability.arn
}

# Evaluations and the record-only gate. Same size reason as observability.
data "aws_iam_policy_document" "deploy_evaluations" {
  statement {
    sid    = "EvaluationRoles"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-evaluation",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-id-evaluator",
    ]
  }

  statement {
    sid     = "PassIdEvaluatorRole"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-id-evaluator",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid     = "PassEvaluationRole"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-evaluation",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["bedrock-agentcore.amazonaws.com"]
    }
  }

  statement {
    sid    = "IdEvaluatorFunction"
    effect = "Allow"
    actions = [
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:GetPolicy",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:ListVersionsByFunction",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:ListTags",
      "lambda:AddPermission",
      "lambda:RemovePermission",
      "lambda:InvokeFunction",
    ]
    resources = [
      "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-id-evaluator",
    ]
  }

  statement {
    sid    = "IdEvaluatorLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:DescribeLogGroups",
      "logs:PutRetentionPolicy",
      "logs:DeleteRetentionPolicy",
      "logs:AssociateKmsKey",
      "logs:DisassociateKmsKey",
      "logs:ListTagsForResource",
      "logs:TagResource",
      "logs:UntagResource",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-id-evaluator",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-id-evaluator:*",
    ]
  }

  statement {
    sid    = "Evaluators"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:CreateEvaluator",
      "bedrock-agentcore:GetEvaluator",
      "bedrock-agentcore:UpdateEvaluator",
      "bedrock-agentcore:DeleteEvaluator",
      "bedrock-agentcore:ListEvaluators",
    ]
    resources = [
      "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:evaluator/*",
    ]
  }

  statement {
    sid       = "CreateEvaluator"
    effect    = "Allow"
    actions   = ["bedrock-agentcore:CreateEvaluator"]
    resources = ["*"]
  }

  statement {
    sid     = "GateInvokeDefault"
    effect  = "Allow"
    actions = ["bedrock-agentcore:InvokeAgentRuntime"]
    resources = [
      "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:runtime/*",
      "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:runtime/*/runtime-endpoint/DEFAULT",
    ]
  }

  statement {
    sid    = "BatchEvaluations"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:StartBatchEvaluation",
      "bedrock-agentcore:GetBatchEvaluation",
      "bedrock-agentcore:ListBatchEvaluations",
      "bedrock-agentcore:StopBatchEvaluation",
      "bedrock-agentcore:DeleteBatchEvaluation",
    ]
    resources = [
      "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:batch-evaluate/*",
    ]
  }

  statement {
    sid    = "GateReadRuntimeSpans"
    effect = "Allow"
    actions = [
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "logs:GetQueryResults",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*:*",
    ]
  }

  statement {
    sid    = "GateWriteEvaluationLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:PutRetentionPolicy",
      "logs:AssociateKmsKey",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*:*",
    ]
  }

  statement {
    sid    = "GateUseLogsKeyViaService"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["logs.${var.aws_region}.amazonaws.com", "bedrock-agentcore.${var.aws_region}.amazonaws.com"]
    }
  }

  # StartBatchEvaluation dry-runs caller KMS with the batch evaluation encryption context.
  statement {
    sid    = "GateDescribeLogsKey"
    effect = "Allow"
    actions = [
      "kms:DescribeKey",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "GateBatchEvaluationKey"
    effect = "Allow"
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
    ]
    resources = ["*"]

    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:bedrock-agentcore:batchEvaluationArn"
      values   = ["arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:batch-evaluate/*"]
    }
  }
}

resource "aws_iam_policy" "deploy_evaluations" {
  name        = "${var.project_name}-evaluations"
  description = "Lets the deploy role manage the id evaluator, evaluation role, and run the Faithfulness gate."
  policy      = data.aws_iam_policy_document.deploy_evaluations.json
}

resource "aws_iam_role_policy_attachment" "deploy_evaluations" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_evaluations.arn
}
