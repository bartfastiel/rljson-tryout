#!/usr/bin/env bash
set -euo pipefail

# Idempotently creates the AWS resources the Terraform S3 backend needs and
# points GitHub Actions at them:
#   - an S3 bucket for Terraform state (versioned, encrypted, not public)
#   - an IAM role that GitHub Actions assumes through the existing GitHub
#     OIDC provider, restricted to that one bucket
#   - the repository variable AWS_ROLE_ARN, so workflows can assume the role
#     without long-lived AWS credentials
#
# Run once with local AWS credentials that have IAM and S3 rights, and an
# authenticated gh CLI. Every step checks the current state before it
# changes anything, so re-running the script on an already bootstrapped
# account leaves it unchanged and exits 0.
#
# On Windows the script runs in Git Bash. MSYS_NO_PATHCONV avoids Git Bash
# rewriting arguments that merely look like POSIX paths (ARNs, OIDC
# provider URLs) into Windows paths before they reach the AWS CLI.
export MSYS_NO_PATHCONV=1
export AWS_PAGER=""

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-bartfastiel/rljson-tryout}"
STATE_BUCKET="${STATE_BUCKET:-bartfastiel-rljson-tryout-tfstate}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
ROLE_NAME="${ROLE_NAME:-github-actions-rljson-tryout}"

# Everything below is derived from the parameters above.
INLINE_POLICY_NAME="terraform-state"
OIDC_PROVIDER_HOST="token.actions.githubusercontent.com"
# AWS validates the format of this thumbprint but, since 2023, no longer
# uses it to verify GitHub's token: AWS trusts its own root certificate
# store for token.actions.githubusercontent.com. The value below is the
# thumbprint AWS's own documentation still lists for new providers.
GITHUB_OIDC_THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea"
BUCKET_ARN="arn:aws:s3:::${STATE_BUCKET}"

ACCOUNT_ID="$(aws sts get-caller-identity --query 'Account' --output text)"
echo "Bootstrapping Terraform state backend for ${GITHUB_REPOSITORY} in account ${ACCOUNT_ID}, region ${AWS_REGION}." >&2

# --- S3 state bucket ---------------------------------------------------

if aws s3api head-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "Bucket ${STATE_BUCKET} already exists." >&2
else
  echo "Creating bucket ${STATE_BUCKET} in ${AWS_REGION}." >&2
  aws s3api create-bucket \
    --bucket "${STATE_BUCKET}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration "LocationConstraint=${AWS_REGION}" \
    >/dev/null
fi

aws s3api put-bucket-versioning \
  --bucket "${STATE_BUCKET}" \
  --region "${AWS_REGION}" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "${STATE_BUCKET}" \
  --region "${AWS_REGION}" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block \
  --bucket "${STATE_BUCKET}" \
  --region "${AWS_REGION}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# --- GitHub OIDC provider -----------------------------------------------

OIDC_PROVIDER_ARN="$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?ends_with(Arn, '/${OIDC_PROVIDER_HOST}')].Arn | [0]" \
  --output text)"

if [[ -n "${OIDC_PROVIDER_ARN}" && "${OIDC_PROVIDER_ARN}" != "None" ]]; then
  echo "OIDC provider already exists: ${OIDC_PROVIDER_ARN}" >&2
else
  echo "Creating OIDC provider for ${OIDC_PROVIDER_HOST}." >&2
  OIDC_PROVIDER_ARN="$(aws iam create-open-id-connect-provider \
    --url "https://${OIDC_PROVIDER_HOST}" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "${GITHUB_OIDC_THUMBPRINT}" \
    --query 'OpenIDConnectProviderArn' --output text)"
fi

# --- IAM role trusting that provider for this repository ---------------

TRUST_POLICY_JSON="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_PROVIDER_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER_HOST}:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "${OIDC_PROVIDER_HOST}:sub": "repo:${GITHUB_REPOSITORY}:*"
        }
      }
    }
  ]
}
JSON
)"

if aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  echo "Role ${ROLE_NAME} already exists, refreshing its trust policy." >&2
  aws iam update-assume-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-document "${TRUST_POLICY_JSON}"
else
  echo "Creating role ${ROLE_NAME}." >&2
  aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --description "GitHub Actions OIDC role for the Terraform state bucket of ${GITHUB_REPOSITORY}" \
    --assume-role-policy-document "${TRUST_POLICY_JSON}" \
    >/dev/null
fi

ROLE_ARN="$(aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text)"

INLINE_POLICY_JSON="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListAndInspectStateBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketVersioning"],
      "Resource": "${BUCKET_ARN}"
    },
    {
      "Sid": "ReadWriteStateObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "${BUCKET_ARN}/*"
    }
  ]
}
JSON
)"

if aws iam get-role-policy --role-name "${ROLE_NAME}" --policy-name "${INLINE_POLICY_NAME}" \
     >/dev/null 2>&1; then
  echo "Inline policy ${INLINE_POLICY_NAME} already exists, refreshing it." >&2
else
  echo "Writing inline policy ${INLINE_POLICY_NAME} on role ${ROLE_NAME}." >&2
fi
aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "${INLINE_POLICY_NAME}" \
  --policy-document "${INLINE_POLICY_JSON}"

# --- Repository variable -------------------------------------------------

gh variable set AWS_ROLE_ARN --repo "${GITHUB_REPOSITORY}" --body "${ROLE_ARN}"

echo
echo "State bucket:            ${STATE_BUCKET}"
echo "Role ARN:                 ${ROLE_ARN}"
echo "Repository variable:     AWS_ROLE_ARN set for ${GITHUB_REPOSITORY}"
