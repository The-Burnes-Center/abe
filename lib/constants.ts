import { brand } from "../config/brand";

export const AUTHENTICATION = true;

// All deployment identifiers derive from the brand slug (config/brand.ts) and
// can be overridden per-deployment via environment variables.

// Cognito hosted-UI domain PREFIX — must be globally unique across all AWS
// accounts. Override with COGNITO_DOMAIN_PREFIX if needed.
export const cognitoDomainName = process.env.COGNITO_DOMAIN_PREFIX || "abe-burnes-auth";

// Federated OIDC provider name configured in Cognito. Leave blank ("") if you
// have no SSO provider — username/password sign-in & sign-up still work.
export const OIDCIntegrationName = process.env.OIDC_PROVIDER_NAME || "";

// CloudFormation stack name — must be unique within your AWS account/region.
// Uppercased slug keeps acronym brands clean (abe -> ABEStack). Override with
// STACK_NAME for a multi-word brand where all-caps would read oddly.
export const stackName =
  process.env.STACK_NAME || `${brand.slug.toUpperCase()}Stack`;
