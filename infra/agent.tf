locals {
  chat_model_id = "amazon.nova-lite-v1:0"
}

data "aws_iam_policy_document" "artifacts" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.artifacts.arn,
      "${aws_s3_bucket.artifacts.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.project_name}-artifacts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = data.aws_iam_policy_document.artifacts.json

  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}

resource "aws_s3_object" "agent" {
  bucket = aws_s3_bucket.artifacts.id
  key    = "agent/${var.agent_source_sha}.zip"
  source = "${path.module}/build/agent.zip"
  etag   = filemd5("${path.module}/build/agent.zip")
}

data "aws_iam_policy_document" "agent_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "agent" {
  name               = "${var.project_name}-agent"
  assume_role_policy = data.aws_iam_policy_document.agent_assume.json
  description        = "Assumed by the journal agent runtime to retrieve entries and call the chat model."
}

data "aws_iam_policy_document" "agent" {
  statement {
    sid       = "RetrieveEntries"
    effect    = "Allow"
    actions   = ["bedrock:Retrieve"]
    resources = [aws_bedrockagent_knowledge_base.journal.arn]
  }

  statement {
    sid    = "Chat"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:Converse",
    ]
    resources = [
      "arn:aws:bedrock:${var.aws_region}::foundation-model/${local.chat_model_id}",
      "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/eu.${local.chat_model_id}",
    ]
  }

  statement {
    sid       = "ReadAgentZip"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/agent/*"]
  }

  statement {
    sid    = "RuntimeLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
    ]
  }
}

resource "aws_iam_role_policy" "agent" {
  name   = "${var.project_name}-agent"
  role   = aws_iam_role.agent.id
  policy = data.aws_iam_policy_document.agent.json
}

resource "aws_bedrockagentcore_agent_runtime" "journal" {
  agent_runtime_name = replace(var.project_name, "-", "_")
  role_arn           = aws_iam_role.agent.arn
  description        = "Answers a question from journal entries and returns the entry ids it used."

  agent_runtime_artifact {
    code_configuration {
      entry_point = ["main.py"]
      runtime     = "PYTHON_3_13"

      code {
        s3 {
          bucket = aws_s3_bucket.artifacts.id
          prefix = aws_s3_object.agent.key
        }
      }
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  environment_variables = {
    AWS_REGION        = var.aws_region
    KNOWLEDGE_BASE_ID = aws_bedrockagent_knowledge_base.journal.id
    MODEL_ID          = local.chat_model_id
  }

  depends_on = [aws_iam_role_policy.agent]
}
