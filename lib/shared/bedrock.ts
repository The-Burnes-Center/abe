import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

const PRIMARY_MODEL = 'anthropic.claude-opus-4-6-v1';
const FAST_MODEL = 'anthropic.claude-sonnet-4-6';

/** Prefix of a cross-region inference profile id (e.g. "us." in us.anthropic.claude-...). */
const INFERENCE_PROFILE_PREFIX = /^(us|us-gov|eu|apac|jp|au|ca|global)\./;

/**
 * Geo prefix for the system-defined cross-region inference profile that
 * serves the stack's region. Unknown or unresolved regions fall back to
 * "us." (unresolved: env-agnostic synth) or "global." (other geographies).
 */
export function inferenceProfilePrefix(scope: IConstruct): string {
  const region = cdk.Stack.of(scope).region;
  if (cdk.Token.isUnresolved(region) || region.startsWith('us-')) return 'us.';
  if (region.startsWith('eu-')) return 'eu.';
  if (region.startsWith('ap-')) return 'apac.';
  return 'global.';
}

export interface ModelIds {
  readonly primary: string;
  readonly fast: string;
}

/** Chat/eval model ids: PRIMARY_MODEL_ID / FAST_MODEL_ID env overrides, else region-appropriate profiles. */
export function modelIds(scope: IConstruct): ModelIds {
  const prefix = inferenceProfilePrefix(scope);
  return {
    primary: process.env.PRIMARY_MODEL_ID || `${prefix}${PRIMARY_MODEL}`,
    fast: process.env.FAST_MODEL_ID || `${prefix}${FAST_MODEL}`,
  };
}

/**
 * IAM resources for invoking Anthropic models directly or through any
 * cross-region / global inference profile. The region wildcard is required
 * because a profile routes to whichever region has capacity.
 */
export function anthropicInvokeResources(): string[] {
  return [
    `arn:${cdk.Aws.PARTITION}:bedrock:*::foundation-model/anthropic.*`,
    `arn:${cdk.Aws.PARTITION}:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*`,
  ];
}

export function isInferenceProfileId(modelId: string): boolean {
  return INFERENCE_PROFILE_PREFIX.test(modelId);
}

/**
 * ARN that Bedrock accepts for a model id or an inference profile id in this
 * stack's region. Uses the stack's partition/region (literals when the stack
 * has a concrete env), so resource properties stay byte-stable across synths.
 */
export function modelOrProfileArn(scope: IConstruct, modelId: string): string {
  const { partition, region, account } = cdk.Stack.of(scope);
  return isInferenceProfileId(modelId)
    ? `arn:${partition}:bedrock:${region}:${account}:inference-profile/${modelId}`
    : `arn:${partition}:bedrock:${region}::foundation-model/${modelId}`;
}

/** Foundation-model ARN pattern (any region) for the model behind a model or profile id. */
export function underlyingModelArn(modelId: string): string {
  const base = modelId.replace(INFERENCE_PROFILE_PREFIX, '');
  return `arn:${cdk.Aws.PARTITION}:bedrock:*::foundation-model/${base}`;
}
