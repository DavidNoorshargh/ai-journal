# The password is set once after apply and stored in Secrets Manager.
# It is not a Terraform value, so it stays out of git and out of the public plan artifact.

resource "aws_cognito_user_pool" "journal" {
  name = var.project_name

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  password_policy {
    minimum_length                   = 16
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }
}

resource "aws_cognito_user_pool_client" "journal" {
  name         = var.project_name
  user_pool_id = aws_cognito_user_pool.journal.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  refresh_token_validity = 30
  access_token_validity  = 60
  id_token_validity      = 60

  token_validity_units {
    refresh_token = "days"
    access_token  = "minutes"
    id_token      = "minutes"
  }
}

resource "aws_cognito_user" "journal" {
  user_pool_id = aws_cognito_user_pool.journal.id
  username     = var.journal_user_email

  attributes = {
    email          = var.journal_user_email
    email_verified = "true"
  }

  message_action = "SUPPRESS"
}

resource "aws_cognito_identity_pool" "journal" {
  identity_pool_name               = var.project_name
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.journal.id
    provider_name           = aws_cognito_user_pool.journal.endpoint
    server_side_token_check = true
  }
}

data "aws_iam_policy_document" "entries_write_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = ["cognito-identity.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "cognito-identity.amazonaws.com:aud"
      values   = [aws_cognito_identity_pool.journal.id]
    }

    condition {
      test     = "ForAnyValue:StringLike"
      variable = "cognito-identity.amazonaws.com:amr"
      values   = ["authenticated"]
    }
  }
}

resource "aws_iam_role" "entries_write" {
  name               = "${var.project_name}-entries-write"
  assume_role_policy = data.aws_iam_policy_document.entries_write_assume.json
  description        = "Temporary credentials for the signed-in journal user. Put and delete under entries/ only."
}

data "aws_iam_policy_document" "entries_write" {
  statement {
    sid    = "WriteEntries"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.entries.arn}/entries/*"]
  }
}

resource "aws_iam_role_policy" "entries_write" {
  name   = "${var.project_name}-entries-write"
  role   = aws_iam_role.entries_write.id
  policy = data.aws_iam_policy_document.entries_write.json
}

resource "aws_cognito_identity_pool_roles_attachment" "journal" {
  identity_pool_id = aws_cognito_identity_pool.journal.id

  roles = {
    authenticated = aws_iam_role.entries_write.arn
  }
}
