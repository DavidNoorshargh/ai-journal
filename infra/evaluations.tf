# Id evaluator Lambda, evaluation role, and AgentCore evaluator registration.
# The golden dataset file lives in git; the gate job loads it and runs batch eval.

data "archive_file" "id_evaluator" {
  type        = "zip"
  source_file = "${path.module}/../agent/evals/id_evaluator.py"
  output_path = "${path.module}/build/id_evaluator.zip"
}

data "aws_iam_policy_document" "id_evaluator_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "id_evaluator" {
  name               = "${var.project_name}-id-evaluator"
  assume_role_policy = data.aws_iam_policy_document.id_evaluator_assume.json
  description        = "Runs the code-based entry-id evaluator for AgentCore Faithfulness."
}

data "aws_iam_policy_document" "id_evaluator" {
  statement {
    sid    = "OwnLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-id-evaluator",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-id-evaluator:*",
    ]
  }
}

resource "aws_iam_role_policy" "id_evaluator" {
  name   = "${var.project_name}-id-evaluator"
  role   = aws_iam_role.id_evaluator.id
  policy = data.aws_iam_policy_document.id_evaluator.json
}

resource "aws_cloudwatch_log_group" "id_evaluator" {
  name              = "/aws/lambda/${var.project_name}-id-evaluator"
  retention_in_days = 14
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_lambda_function" "id_evaluator" {
  function_name    = "${var.project_name}-id-evaluator"
  role             = aws_iam_role.id_evaluator.arn
  runtime          = "python3.13"
  handler          = "id_evaluator.handler"
  filename         = data.archive_file.id_evaluator.output_path
  source_code_hash = data.archive_file.id_evaluator.output_base64sha256
  timeout          = 30

  depends_on = [
    aws_cloudwatch_log_group.id_evaluator,
    aws_iam_role_policy.id_evaluator,
  ]
}

data "aws_iam_policy_document" "evaluation_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
    }
  }
}

resource "aws_iam_role" "evaluation" {
  name               = "${var.project_name}-evaluation"
  assume_role_policy = data.aws_iam_policy_document.evaluation_assume.json
  description        = "Assumed by AgentCore Evaluations to read runtime spans and invoke the id evaluator."
}

data "aws_iam_policy_document" "evaluation" {
  statement {
    sid    = "ReadRuntimeSpans"
    effect = "Allow"
    actions = [
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "logs:GetQueryResults",
    ]
    resources = [
      "${aws_cloudwatch_log_group.agent_default.arn}:*",
      "${aws_cloudwatch_log_group.agent_production.arn}:*",
    ]
  }

  statement {
    sid       = "DescribeRuntimeLogGroups"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
  }

  statement {
    sid    = "WriteEvaluationResults"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*",
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/bedrock-agentcore/evaluations/*:*",
    ]
  }

  statement {
    sid    = "InvokeIdEvaluator"
    effect = "Allow"
    actions = [
      "lambda:InvokeFunction",
      "lambda:GetFunction",
    ]
    resources = [aws_lambda_function.id_evaluator.arn]
  }
}

resource "aws_iam_role_policy" "evaluation" {
  name   = "${var.project_name}-evaluation"
  role   = aws_iam_role.evaluation.id
  policy = data.aws_iam_policy_document.evaluation.json
}

resource "aws_lambda_permission" "id_evaluator_agentcore" {
  statement_id   = "AllowAgentCoreEvaluations"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.id_evaluator.function_name
  principal      = "bedrock-agentcore.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_bedrockagentcore_evaluator" "entry_ids" {
  evaluator_name = "ai_journal_entry_ids"
  description    = "PASS when search_entries returned the expected fixture entry ids."
  level          = "TRACE"

  evaluator_config {
    code_based {
      lambda_config {
        lambda_arn                = aws_lambda_function.id_evaluator.arn
        lambda_timeout_in_seconds = 30
      }
    }
  }

  depends_on = [
    aws_lambda_permission.id_evaluator_agentcore,
    aws_iam_role_policy.evaluation,
  ]
}

resource "aws_bedrockagentcore_online_evaluation_config" "production" {
  online_evaluation_config_name = "ai_journal_production"
  description                   = "Scores every production answer with Builtin.Faithfulness."
  enable_on_create              = true
  evaluation_execution_role_arn = aws_iam_role.evaluation.arn

  data_source_config {
    cloudwatch_logs {
      log_group_names = [aws_cloudwatch_log_group.agent_production.name]
      service_names   = [local.agent_production_service_name]
    }
  }

  evaluator {
    evaluator_id = "Builtin.Faithfulness"
  }

  rule {
    sampling_config {
      sampling_percentage = 100
    }

    session_config {
      session_timeout_minutes = 5
    }
  }

  depends_on = [
    aws_iam_role_policy.evaluation,
    aws_xray_trace_segment_destination.cloudwatch,
  ]
}

resource "aws_sns_topic" "faithfulness" {
  name              = "${var.project_name}-faithfulness"
  kms_master_key_id = aws_kms_key.logs.id
}

data "aws_iam_policy_document" "faithfulness_topic" {
  statement {
    sid    = "AllowCloudWatchAlarms"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.faithfulness.arn]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "faithfulness" {
  arn    = aws_sns_topic.faithfulness.arn
  policy = data.aws_iam_policy_document.faithfulness_topic.json
}

resource "aws_sns_topic_subscription" "faithfulness_email" {
  topic_arn = aws_sns_topic.faithfulness.arn
  protocol  = "email"
  endpoint  = var.journal_user_email
}

resource "aws_cloudwatch_metric_alarm" "faithfulness" {
  alarm_name          = "${var.project_name}-faithfulness"
  alarm_description   = "Production Builtin.Faithfulness average dropped below the provisional threshold."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  metric_name         = "Builtin.Faithfulness"
  namespace           = "Bedrock-AgentCore/Evaluations"
  period              = 300
  statistic           = "Average"
  threshold           = var.faithfulness_alarm_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    OnlineEvaluationConfigId = aws_bedrockagentcore_online_evaluation_config.production.online_evaluation_config_id
  }

  alarm_actions = [aws_sns_topic.faithfulness.arn]
  ok_actions    = [aws_sns_topic.faithfulness.arn]

  depends_on = [aws_sns_topic_policy.faithfulness]
}

output "id_evaluator_id" {
  description = "AgentCore evaluator id for the entry-id check used by the gate."
  value       = aws_bedrockagentcore_evaluator.entry_ids.evaluator_id
}

output "evaluation_role_arn" {
  description = "Role AgentCore Evaluations assumes for online scoring. Batch uses the caller's credentials."
  value       = aws_iam_role.evaluation.arn
}

output "online_evaluation_config_id" {
  description = "Online evaluation config that scores the production endpoint."
  value       = aws_bedrockagentcore_online_evaluation_config.production.online_evaluation_config_id
}
