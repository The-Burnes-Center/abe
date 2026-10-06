import { Node } from 'constructs';

/**
 * Per-deployment settings. Each value is read from CDK context first
 * (`-c name=value`) and then from the environment variable in parentheses,
 * so local deploys and CI can use whichever is convenient. Nothing here is
 * hardcoded per organization.
 */
export interface DeploymentConfig {
  /** customDomain (CUSTOM_DOMAIN) + certificateArn (CERTIFICATE_ARN, ACM in us-east-1). Both or neither. */
  readonly customDomain?: string;
  readonly certificateArn?: string;
  /** alarmEmail (ALARM_EMAIL): subscribes this address to the alarm topic. */
  readonly alarmEmail?: string;
  /**
   * allowedSignupDomains (ALLOWED_SIGNUP_DOMAINS), comma-separated. Non-empty
   * turns on self sign-up, restricted to these email domains by the PreSignUp
   * trigger. Empty (default): invite-only.
   */
  readonly allowedSignupDomains: string[];
  /** cognitoFeaturePlan (COGNITO_FEATURE_PLAN): ESSENTIALS (default) or PLUS (adds threat protection). */
  readonly cognitoFeaturePlan: 'ESSENTIALS' | 'PLUS';
  /** enableEval (ENABLE_EVAL), default true: the RAGAS evaluation pipeline and its admin pages. */
  readonly enableEval: boolean;
  /** kbParserModel (KB_PARSER_MODEL): model or inference-profile id for FM parsing; unset = default parser. */
  readonly kbParserModel?: string;
  /**
   * apiGatewayAccountRole (API_GATEWAY_ACCOUNT_ROLE), default true: manage the
   * region-wide API Gateway CloudWatch Logs role. Set false for a second stack
   * in the same account and region so the two stacks don't fight over it.
   */
  readonly apiGatewayAccountRole: boolean;
  /** metadataHandlerConcurrency (METADATA_HANDLER_CONCURRENCY): optional reserved concurrency cap. */
  readonly metadataHandlerConcurrency?: number;
}

const FEATURE_PLANS = ['ESSENTIALS', 'PLUS'] as const;
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function read(node: Node, contextKey: string, envKey: string): string | undefined {
  const fromContext = node.tryGetContext(contextKey);
  const value = fromContext !== undefined ? String(fromContext) : process.env[envKey];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolean(node: Node, contextKey: string, envKey: string, fallback: boolean): boolean {
  const value = read(node, contextKey, envKey);
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`${contextKey} must be true or false, got "${value}"`);
}

function parseSignupDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  const domains = raw.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const invalid = domains.filter((d) => !DOMAIN_PATTERN.test(d));
  if (invalid.length > 0) {
    throw new Error(`allowedSignupDomains has invalid domain(s): ${invalid.join(', ')}`);
  }
  return [...new Set(domains)];
}

function parseFeaturePlan(raw: string | undefined): DeploymentConfig['cognitoFeaturePlan'] {
  const plan = (raw ?? 'ESSENTIALS').toUpperCase();
  if (!(FEATURE_PLANS as readonly string[]).includes(plan)) {
    throw new Error(`cognitoFeaturePlan must be one of ${FEATURE_PLANS.join(', ')}, got "${raw}"`);
  }
  return plan as DeploymentConfig['cognitoFeaturePlan'];
}

function parseConcurrency(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`metadataHandlerConcurrency must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function readDeploymentConfig(node: Node): DeploymentConfig {
  const customDomain = read(node, 'customDomain', 'CUSTOM_DOMAIN');
  const certificateArn = read(node, 'certificateArn', 'CERTIFICATE_ARN');
  // Bind the custom domain only when BOTH the hostname and its cert ARN are set.
  const bindDomain = !!(customDomain && certificateArn);
  return {
    customDomain: bindDomain ? customDomain : undefined,
    certificateArn: bindDomain ? certificateArn : undefined,
    alarmEmail: read(node, 'alarmEmail', 'ALARM_EMAIL'),
    allowedSignupDomains: parseSignupDomains(read(node, 'allowedSignupDomains', 'ALLOWED_SIGNUP_DOMAINS')),
    cognitoFeaturePlan: parseFeaturePlan(read(node, 'cognitoFeaturePlan', 'COGNITO_FEATURE_PLAN')),
    enableEval: readBoolean(node, 'enableEval', 'ENABLE_EVAL', true),
    kbParserModel: read(node, 'kbParserModel', 'KB_PARSER_MODEL'),
    apiGatewayAccountRole: readBoolean(node, 'apiGatewayAccountRole', 'API_GATEWAY_ACCOUNT_ROLE', true),
    metadataHandlerConcurrency: parseConcurrency(
      read(node, 'metadataHandlerConcurrency', 'METADATA_HANDLER_CONCURRENCY'),
    ),
  };
}
