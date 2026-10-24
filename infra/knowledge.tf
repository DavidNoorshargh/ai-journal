# Bedrock invocation logging is intentionally not configured. Journal text
# stays in the entry bucket and this index, and prompts are not copied to CloudWatch.

locals {
  embedding_model_id   = "amazon.titan-embed-text-v2:0"
  embedding_dimensions = 1024
}

resource "aws_s3vectors_vector_bucket" "journal" {
  vector_bucket_name = "${var.project_name}-vectors-${data.aws_caller_identity.current.account_id}"

  encryption_configuration {
    sse_type = "AES256"
  }
}

resource "aws_s3vectors_index" "entries" {
  index_name         = "entries"
  vector_bucket_name = aws_s3vectors_vector_bucket.journal.vector_bucket_name

  data_type       = "float32"
  dimension       = local.embedding_dimensions
  distance_metric = "cosine"

  # Chunk text and Bedrock's own metadata are large. date and tags stay
  # filterable so a time question can filter before ranking.
  metadata_configuration {
    non_filterable_metadata_keys = [
      "AMAZON_BEDROCK_TEXT",
      "AMAZON_BEDROCK_METADATA",
    ]
  }
}

data "aws_iam_policy_document" "knowledge_base_assume" {
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
      values   = ["arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*"]
    }
  }
}

resource "aws_iam_role" "knowledge_base" {
  name               = "${var.project_name}-knowledge-base"
  assume_role_policy = data.aws_iam_policy_document.knowledge_base_assume.json
  description        = "Assumed by the journal Knowledge Base to embed entries and read the entries prefix."
}

data "aws_iam_policy_document" "knowledge_base" {
  statement {
    sid       = "Embed"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.aws_region}::foundation-model/${local.embedding_model_id}"]
  }

  statement {
    sid       = "ListEntries"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.entries.arn]
  }

  statement {
    sid       = "ReadEntries"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.entries.arn}/entries/*"]
  }

  statement {
    sid    = "Vectors"
    effect = "Allow"
    actions = [
      "s3vectors:GetIndex",
      "s3vectors:QueryVectors",
      "s3vectors:PutVectors",
      "s3vectors:GetVectors",
      "s3vectors:ListVectors",
      "s3vectors:DeleteVectors",
    ]
    resources = [
      aws_s3vectors_vector_bucket.journal.vector_bucket_arn,
      "${aws_s3vectors_vector_bucket.journal.vector_bucket_arn}/index/*",
    ]
  }
}

resource "aws_iam_role_policy" "knowledge_base" {
  name   = "${var.project_name}-knowledge-base"
  role   = aws_iam_role.knowledge_base.id
  policy = data.aws_iam_policy_document.knowledge_base.json
}

resource "aws_bedrockagent_knowledge_base" "journal" {
  name     = var.project_name
  role_arn = aws_iam_role.knowledge_base.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.aws_region}::foundation-model/${local.embedding_model_id}"

      embedding_model_configuration {
        bedrock_embedding_model_configuration {
          dimensions          = local.embedding_dimensions
          embedding_data_type = "FLOAT32"
        }
      }
    }
  }

  storage_configuration {
    type = "S3_VECTORS"

    s3_vectors_configuration {
      index_arn = aws_s3vectors_index.entries.index_arn
    }
  }

  depends_on = [aws_iam_role_policy.knowledge_base]
}

resource "aws_bedrockagent_data_source" "entries" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.journal.id
  name              = "entries"

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn         = aws_s3_bucket.entries.arn
      inclusion_prefixes = ["entries/"]
    }
  }
}
