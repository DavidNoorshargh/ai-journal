locals {
  faithfulness_prefix = "eval/faithfulness"
  faithfulness_judge  = "eu.amazon.nova-pro-v1:0"
}

data "aws_iam_policy_document" "faithfulness_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:evaluation-job/*"]
    }
  }
}

resource "aws_iam_role" "faithfulness" {
  name               = "${var.project_name}-faithfulness"
  assume_role_policy = data.aws_iam_policy_document.faithfulness_assume.json
}

data "aws_iam_policy_document" "faithfulness" {
  statement {
    sid       = "ReadDataset"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/${local.faithfulness_prefix}/input/*"]
  }

  statement {
    sid     = "WriteResults"
    effect  = "Allow"
    actions = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]
    resources = [
      "${aws_s3_bucket.artifacts.arn}/${local.faithfulness_prefix}/output/*",
    ]
  }

  statement {
    sid       = "ListFaithfulnessPrefix"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        local.faithfulness_prefix,
        "${local.faithfulness_prefix}/*",
      ]
    }
  }

  statement {
    sid       = "LocateBucket"
    effect    = "Allow"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.artifacts.arn]
  }

  statement {
    sid    = "InvokeJudge"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:GetInferenceProfile",
    ]
    resources = [
      "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${local.faithfulness_judge}",
      "arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0",
    ]
  }
}

resource "aws_iam_role_policy" "faithfulness" {
  name   = "${var.project_name}-faithfulness"
  role   = aws_iam_role.faithfulness.id
  policy = data.aws_iam_policy_document.faithfulness.json
}
