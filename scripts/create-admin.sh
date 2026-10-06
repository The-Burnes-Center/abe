#!/usr/bin/env bash
# Invite the first (or any) administrator to a deployed stack.
#
# Creates the Cognito user with an emailed temporary password and adds it to
# the Admin group. Re-running for an existing user just ensures group
# membership.
#
# Usage:
#   scripts/create-admin.sh --email admin@example.org [--stack-name ABEStack] [--region us-east-1]
#
# Requires the AWS CLI with credentials for the account the stack is in.
# Stack name defaults to $STACK_NAME, then ABEStack. Region defaults to
# $AWS_REGION / $AWS_DEFAULT_REGION, then the CLI profile's region.
set -euo pipefail

ADMIN_GROUP="Admin"
EMAIL=""
STACK_NAME="${STACK_NAME:-ABEStack}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --stack-name) STACK_NAME="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 1 ;;
  esac
done

if [[ -z "$EMAIL" ]]; then
  echo "Error: --email is required." >&2
  usage 1
fi
if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Error: '$EMAIL' is not a valid email address." >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "Error: the AWS CLI is not installed (https://aws.amazon.com/cli/)." >&2
  exit 1
fi

# Run the AWS CLI with --region only when one was given (else the profile's).
aws_cli() {
  if [[ -n "$REGION" ]]; then
    aws --region "$REGION" "$@"
  else
    aws "$@"
  fi
}

stack_output() {
  aws_cli cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

USER_POOL_ID="$(stack_output UserPoolId 2>/dev/null || true)"
if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  echo "Error: could not read the UserPoolId output of stack '$STACK_NAME'." >&2
  echo "Check the stack name, region and AWS credentials (aws cloudformation describe-stacks --stack-name $STACK_NAME)." >&2
  exit 1
fi
APP_URL="$(stack_output AppUrl 2>/dev/null || true)"

echo "User pool: $USER_POOL_ID (stack $STACK_NAME)"

if aws_cli cognito-idp admin-get-user \
    --user-pool-id "$USER_POOL_ID" --username "$EMAIL" >/dev/null 2>&1; then
  echo "User $EMAIL already exists; ensuring Admin group membership."
else
  aws_cli cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --desired-delivery-mediums EMAIL >/dev/null
  echo "Invited $EMAIL. Cognito has emailed a temporary password (valid 7 days)."
fi

aws_cli cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --group-name "$ADMIN_GROUP"
echo "Added $EMAIL to the $ADMIN_GROUP group."

if [[ -n "$APP_URL" && "$APP_URL" != "None" ]]; then
  echo "Sign in at: $APP_URL"
fi
