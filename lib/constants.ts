import { brand } from "../config/brand";

// All deployment identifiers derive from the brand slug (config/brand.ts) and
// can be overridden per-deployment via environment variables.

// CloudFormation stack name — must be unique within your AWS account/region.
// Uppercased slug keeps acronym brands clean (abe -> ABEStack). Override with
// STACK_NAME to run a second copy (e.g. staging) in the same account.
export const stackName =
  process.env.STACK_NAME || `${brand.slug.toUpperCase()}Stack`;

/** Prompt-registry partition key shared by the chat Lambda and the eval generator (e.g. "ABE_CHAT"). */
export const PROMPT_FAMILY = `${brand.slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CHAT`;

/** CloudWatch namespace for custom metrics the chat Lambda emits via EMF (e.g. "ABE/Chat"). */
export const METRICS_NAMESPACE = `${brand.slug.toUpperCase()}/Chat`;
/** Separate namespace for the eval generator so eval runs never trip chat alarms. */
export const EVAL_METRICS_NAMESPACE = `${brand.slug.toUpperCase()}/Eval`;

/** Cognito group whose members get the admin UI and admin APIs (read from `cognito:groups`). */
export const ADMIN_GROUP_NAME = "Admin";

/**
 * IANA timezone used for schedules and for formatting times in Lambdas.
 * config/brand.ts owns the value (BRAND_TIMEZONE env override); the cast keeps
 * this compiling against brand configs that predate the field.
 */
export const BRAND_TIMEZONE =
  (brand as { timezone?: string }).timezone || process.env.BRAND_TIMEZONE || "America/New_York";

/** Brand values the system prompt needs, passed to every Lambda that builds it. */
export const BRAND_PROMPT_ENV: Record<string, string> = {
  ASSISTANT_NAME: brand.assistantName,
  // ORGANIZATION is the name the chat Lambda has always read; ORGANIZATION_NAME
  // matches the brand env var and is what newer handlers read.
  ORGANIZATION: brand.organizationName,
  ORGANIZATION_NAME: brand.organizationName,
  SUPPORT_CONTACT: brand.supportContact,
  DOMAIN_CONTEXT: brand.domainContext,
  BRAND_TIMEZONE,
};
