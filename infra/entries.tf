data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "entries" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.entries.arn,
      "${aws_s3_bucket.entries.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket" "entries" {
  bucket = "${var.project_name}-entries-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "entries" {
  bucket = aws_s3_bucket.entries.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "entries" {
  bucket = aws_s3_bucket.entries.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "entries" {
  bucket = aws_s3_bucket.entries.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "entries" {
  bucket = aws_s3_bucket.entries.id
  policy = data.aws_iam_policy_document.entries.json

  depends_on = [aws_s3_bucket_public_access_block.entries]
}
