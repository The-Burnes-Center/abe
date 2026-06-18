import { brand } from "../config/brand";

export const AUTHENTICATION = true;

// All deployment identifiers derive from the brand slug (config/brand.ts) and
// can be overridden per-deployment via environment variables.

// Cognito hosted-UI domain PREFIX — must be globally unique across all AWS
// accounts. Override with COGNITO_DOMAIN_PREFIX if "<slug>-auth" is taken.
export const cognitoDomainName = process.env.COGNITO_DOMAIN_PREFIX || `${brand.slug}-auth`;

// Federated OIDC provider name configured in Cognito. Leave blank ("") if you
// have no SSO provider — username/password sign-in & sign-up still work.
export const OIDCIntegrationName = process.env.OIDC_PROVIDER_NAME || "";

// CloudFormation stack name — must be unique within your AWS account/region.
export const stackName =
  process.env.STACK_NAME || `${brand.slug.charAt(0).toUpperCase()}${brand.slug.slice(1)}Stack`;
