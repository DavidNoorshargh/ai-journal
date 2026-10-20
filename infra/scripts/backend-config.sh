#!/usr/bin/env bash
# Writes backend.hcl for the main stack from the account the deploy role is in.
# Names match infra/bootstrap: ${project}-tfstate-${account} and ${project}-tf-lock.
set -euo pipefail

region="${AWS_REGION:?Set AWS_REGION}"
project="${PROJECT_NAME:-ai-journal}"
account="$(aws sts get-caller-identity --query Account --output text)"

cat > backend.hcl <<EOF
bucket         = "${project}-tfstate-${account}"
key            = "${project}/terraform.tfstate"
region         = "${region}"
dynamodb_table = "${project}-tf-lock"
encrypt        = true
EOF
