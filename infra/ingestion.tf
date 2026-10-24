data "archive_file" "ingestion" {
  type        = "zip"
  source_file = "${path.module}/../ingestion/handler.py"
  output_path = "${path.module}/.terraform/ingestion.zip"
}

resource "aws_sqs_queue" "ingestion_dlq" {
  name                    = "${var.project_name}-ingestion-dlq"
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "ingestion" {
  name                       = "${var.project_name}-ingestion"
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 180

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "ingestion_queue" {
  statement {
    sid    = "AllowEntryBucket"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.ingestion.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.entries.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "ingestion" {
  queue_url = aws_sqs_queue.ingestion.id
  policy    = data.aws_iam_policy_document.ingestion_queue.json
}

resource "aws_s3_bucket_notification" "entries" {
  bucket = aws_s3_bucket.entries.id

  queue {
    queue_arn     = aws_sqs_queue.ingestion.arn
    events        = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    filter_prefix = "entries/"
  }

  depends_on = [aws_sqs_queue_policy.ingestion]
}

resource "aws_cloudwatch_log_group" "ingestion" {
  name              = "/aws/lambda/${var.project_name}-ingestion"
  retention_in_days = 14
}

data "aws_iam_policy_document" "ingestion_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ingestion" {
  name               = "${var.project_name}-ingestion"
  assume_role_policy = data.aws_iam_policy_document.ingestion_assume.json
  description        = "Starts one Knowledge Base ingestion job per batch of entry-bucket events."
}

data "aws_iam_policy_document" "ingestion" {
  statement {
    sid    = "ReadQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.ingestion.arn]
  }

  statement {
    sid       = "StartIngestion"
    effect    = "Allow"
    actions   = ["bedrock:StartIngestionJob"]
    resources = [aws_bedrockagent_knowledge_base.journal.arn]
  }

  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ingestion.arn}:*"]
  }
}

resource "aws_iam_role_policy" "ingestion" {
  name   = "${var.project_name}-ingestion"
  role   = aws_iam_role.ingestion.id
  policy = data.aws_iam_policy_document.ingestion.json
}

resource "aws_lambda_function" "ingestion" {
  function_name    = "${var.project_name}-ingestion"
  role             = aws_iam_role.ingestion.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.ingestion.output_path
  source_code_hash = data.archive_file.ingestion.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      KNOWLEDGE_BASE_ID = aws_bedrockagent_knowledge_base.journal.id
      DATA_SOURCE_ID    = aws_bedrockagent_data_source.entries.data_source_id
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.ingestion,
    aws_iam_role_policy.ingestion,
  ]
}

resource "aws_lambda_event_source_mapping" "ingestion" {
  event_source_arn                   = aws_sqs_queue.ingestion.arn
  function_name                      = aws_lambda_function.ingestion.arn
  batch_size                         = 100
  maximum_batching_window_in_seconds = 60
}
