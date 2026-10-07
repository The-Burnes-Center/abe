import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Template, Match } from 'aws-cdk-lib/assertions';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ABEStack } from '../lib/abe-stack';
import { brand } from '../config/brand';

// Synth is a few seconds per stack; nag + several variants need headroom.
jest.setTimeout(180_000);

const MAX_RESOURCES = 500;

interface SynthOptions {
  readonly context?: Record<string, string>;
  readonly stackName?: string;
  readonly region?: string;
}

interface Synthesized {
  readonly stack: ABEStack;
  readonly template: Template;
}

/**
 * Build a stack the way bin/abe.ts does (cdk-nag included). Asset bundling is
 * skipped so tests need neither Docker nor a frontend build.
 */
function synth(opts: SynthOptions = {}): Synthesized {
  const app = new cdk.App({
    context: { 'aws:cdk:bundling-stacks': [], ...(opts.context ?? {}) },
  });
  const env = opts.region ? { account: '123456789012', region: opts.region } : undefined;
  const stack = new ABEStack(app, opts.stackName ?? 'TestStack', { env });
  Aspects.of(app).add(new AwsSolutionsChecks());
  return { stack, template: Template.fromStack(stack) };
}

function resourcesOfType(template: Template, type: string): Record<string, any> {
  return template.findResources(type);
}

/** The chat Lambda is the only function with a WebSocket endpoint in its env. */
function chatFunction(t: Template): any {
  return Object.values(resourcesOfType(t, 'AWS::Lambda::Function'))
    .find((f) => f.Properties.Environment?.Variables?.WEBSOCKET_API_ENDPOINT);
}

/** The eval generator: same prompt inputs as chat, but no WebSocket endpoint. */
function generatorFunction(t: Template): any {
  return Object.values(resourcesOfType(t, 'AWS::Lambda::Function'))
    .find((f) => f.Properties.Environment?.Variables?.PROMPT_FAMILY
      && f.Properties.Environment?.Variables?.METADATA_RETRIEVAL_FUNCTION
      && !f.Properties.Environment?.Variables?.WEBSOCKET_API_ENDPOINT);
}

function nagErrors(stack: cdk.Stack) {
  return Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-.*'));
}

let defaults: Synthesized;
let template: Template;
beforeAll(() => {
  defaults = synth();
  template = defaults.template;
});

// ─── Synth health ──────────────────────────────────────────────────────────────

describe('synth health', () => {
  test('default stack has no unsuppressed cdk-nag errors', () => {
    expect(nagErrors(defaults.stack)).toEqual([]);
  });

  test('stays under the CloudFormation resource limit', () => {
    const count = Object.keys(template.toJSON().Resources).length;
    expect(count).toBeLessThan(MAX_RESOURCES);
  });

  test('eval disabled + self sign-up stack has no cdk-nag errors', () => {
    const { stack } = synth({ context: { enableEval: 'false', allowedSignupDomains: 'example.org' } });
    expect(nagErrors(stack)).toEqual([]);
  });

  test('us-east-1 stack with PLUS plan and custom domain has no cdk-nag errors', () => {
    const { stack } = synth({
      region: 'us-east-1',
      context: {
        cognitoFeaturePlan: 'PLUS',
        customDomain: 'chat.example.org',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
      },
    });
    expect(nagErrors(stack)).toEqual([]);
  });

  test.each([
    ['foundation model', 'anthropic.claude-3-5-sonnet-20240620-v1:0'],
    ['inference profile', 'us.anthropic.claude-sonnet-4-6'],
  ])('opt-in KB parser model (%s) has no cdk-nag errors', (_kind, model) => {
    const { stack } = synth({ context: { kbParserModel: model } });
    expect(nagErrors(stack)).toEqual([]);
  });

  test('a configured guardrail grants ApplyGuardrail to the chat Lambda', () => {
    process.env.GUARDRAIL_ID = 'gr-test123';
    try {
      const { template: t } = synth();
      t.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'bedrock:ApplyGuardrail' }),
          ]),
        },
      });
    } finally {
      delete process.env.GUARDRAIL_ID;
    }
  });

  test('rejects an invalid sign-up domain at synth', () => {
    expect(() => synth({ context: { allowedSignupDomains: 'not a domain' } })).toThrow(/allowedSignupDomains/);
  });
});

// ─── Cognito ──────────────────────────────────────────────────────────────────

describe('Cognito', () => {
  test('exactly one user pool and one app client, no hosted-UI domain', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 0);
    template.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 0);
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
  });

  test('user pool is retained with deletion protection', () => {
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ DeletionProtection: 'ACTIVE' }),
    });
  });

  test('email is the only sign-in alias and there is no SMS or phone', () => {
    const pool = Object.values(resourcesOfType(template, 'AWS::Cognito::UserPool'))[0].Properties;
    expect(pool.UsernameAttributes).toEqual(['email']);
    expect(pool.AliasAttributes).toBeUndefined();
    expect(pool.AutoVerifiedAttributes).toEqual(['email']);
    expect(pool.SmsConfiguration).toBeUndefined();
    expect(pool.EnabledMfas).toEqual(['SOFTWARE_TOKEN_MFA']);
    expect(pool.MfaConfiguration).toBe('OPTIONAL');
    expect(pool.AccountRecoverySetting.RecoveryMechanisms).toEqual([{ Name: 'verified_email', Priority: 1 }]);
    const schemaNames = (pool.Schema ?? []).map((a: { Name: string }) => a.Name);
    expect(schemaNames).not.toContain('phone_number');
    expect(schemaNames).not.toContain('role');
    template.resourcePropertiesCountIs('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Principal: { Service: 'cognito-idp.amazonaws.com' } })]),
      }),
    }, 0);
  });

  test('ESSENTIALS plan by default, no threat protection', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTier: 'ESSENTIALS',
      UserPoolAddOns: Match.absent(),
    });
  });

  test('strong password policy with 7-day temporary passwords', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 12,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
          TemporaryPasswordValidityDays: 7,
        }),
      },
    });
  });

  test('Admin group exists', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'Admin' });
  });

  test('PreSignUp trigger is always wired', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
  });

  test('self sign-up is off by default', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
    });
  });

  test('self sign-up turns on with an allowlist passed to the trigger', () => {
    const { template: t } = synth({ context: { allowedSignupDomains: 'Example.org, @agency.gov' } });
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: false }),
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { ALLOWED_SIGNUP_DOMAINS: 'example.org,agency.gov' } },
    });
  });

  test('PLUS plan enables threat protection', () => {
    const { template: t } = synth({ context: { cognitoFeaturePlan: 'PLUS' } });
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTier: 'PLUS',
      UserPoolAddOns: { AdvancedSecurityMode: 'ENFORCED' },
    });
  });

  test('app client is a public SRP-only client with no OAuth', () => {
    const client = Object.values(resourcesOfType(template, 'AWS::Cognito::UserPoolClient'))[0].Properties;
    expect(client.ExplicitAuthFlows).toEqual(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']);
    expect(client.GenerateSecret).toBe(false);
    expect(client.AllowedOAuthFlows).toBeUndefined();
    expect(client.CallbackURLs).toBeUndefined();
    expect(client.PreventUserExistenceErrors).toBe('ENABLED');
    expect(client.SupportedIdentityProviders).toEqual(['COGNITO']);
    expect(client.WriteAttributes).toEqual(['email', 'family_name', 'given_name', 'name']);
    // Short-lived tokens so a disabled/demoted user loses access within 15 minutes.
    expect(client.AccessTokenValidity).toBe(15);
    expect(client.IdTokenValidity).toBe(15);
    expect(client.EnableTokenRevocation).toBe(true);
  });

  test('UserPoolId is a top-level stack output', () => {
    template.hasOutput('UserPoolId', Match.anyValue());
  });
});

// ─── APIs ─────────────────────────────────────────────────────────────────────

describe('APIs', () => {
  function httpApiId(t: Template): string {
    const [id] = Object.entries(resourcesOfType(t, 'AWS::ApiGatewayV2::Api'))
      .find(([, r]) => r.Properties.ProtocolType === 'HTTP')!;
    return id;
  }

  test('every HTTP route uses the JWT authorizer', () => {
    const apiId = httpApiId(template);
    const routes = Object.values(resourcesOfType(template, 'AWS::ApiGatewayV2::Route'))
      .filter((r) => r.Properties.ApiId?.Ref === apiId);
    expect(routes.length).toBeGreaterThan(30);
    for (const route of routes) {
      expect({ route: route.Properties.RouteKey, auth: route.Properties.AuthorizationType })
        .toEqual({ route: route.Properties.RouteKey, auth: 'JWT' });
    }
  });

  test('WebSocket $connect uses the Lambda authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$connect',
      AuthorizationType: 'CUSTOM',
    });
  });

  test('user admin routes exist', () => {
    for (const key of [
      'GET /admin/users',
      'POST /admin/users',
      'DELETE /admin/users/{username}',
      'POST /admin/users/{username}/admin',
      'POST /admin/users/{username}/disable',
      'POST /admin/users/{username}/enable',
      'POST /admin/users/{username}/resend-invite',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: key });
    }
  });

  test('user admin Lambda is scoped to the user pool', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ ADMIN_GROUP_NAME: 'Admin', USER_POOL_ID: Match.anyValue() }) },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['cognito-idp:AdminCreateUser', 'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminUserGlobalSignOut']),
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('AppUserPool'), 'Arn'] },
          }),
        ]),
      },
    });
  });

  test('CORS allows only the site origin unless devCorsOrigins is set', () => {
    const httpCors = (t: Template) => Object.values(resourcesOfType(t, 'AWS::ApiGatewayV2::Api'))
      .find((r) => r.Properties.ProtocolType === 'HTTP')!.Properties.CorsConfiguration.AllowOrigins;
    expect(httpCors(template)).toHaveLength(1);
    expect(JSON.stringify(template.toJSON())).not.toContain('localhost');

    const { template: dev } = synth({ context: { devCorsOrigins: 'http://localhost:3000' } });
    expect(httpCors(dev)).toContain('http://localhost:3000');
    dev.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: Match.arrayWith(['http://localhost:3000']) })] },
    });
    expect(() => synth({ context: { devCorsOrigins: 'https://evil.example.com' } })).toThrow(/devCorsOrigins/);
  });

  test('API Gateway account role can be turned off for a second stack', () => {
    template.resourceCountIs('AWS::ApiGateway::Account', 1);
    const { template: t } = synth({ context: { apiGatewayAccountRole: 'false' } });
    t.resourceCountIs('AWS::ApiGateway::Account', 0);
  });
});

// ─── Eval toggle ──────────────────────────────────────────────────────────────

describe('enableEval', () => {
  test('default stack includes the evaluation pipeline', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /eval-run-handler' });
  });

  test('enableEval=false removes the pipeline, its storage and routes', () => {
    const { template: t } = synth({ context: { enableEval: 'false' } });
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 0);
    t.resourceCountIs('AWS::SQS::Queue', 0);
    t.resourcePropertiesCountIs('AWS::Lambda::Function', { PackageType: 'Image' }, 0);
    const routeKeys = Object.values(resourcesOfType(t, 'AWS::ApiGatewayV2::Route'))
      .map((r) => r.Properties.RouteKey as string);
    for (const evalRoute of ['/eval-run-handler', '/eval-results-handler', '/test-library', '/signed-url-test-cases']) {
      expect(routeKeys.some((k) => k.endsWith(evalRoute))).toBe(false);
    }
    t.resourcePropertiesCountIs('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'EvaluationId', KeyType: 'HASH' },
        { AttributeName: 'QuestionId', KeyType: 'RANGE' },
      ],
    }, 0);
  });

  test('eval response generator mirrors the chat prompt inputs', () => {
    const chat = chatFunction(template);
    const gen = generatorFunction(template);
    expect(chat).toBeDefined();
    expect(gen).toBeDefined();
    const chatEnv = chat!.Properties.Environment.Variables;
    const genEnv = gen!.Properties.Environment.Variables;
    expect(genEnv.PROMPT_FAMILY).toBe(chatEnv.PROMPT_FAMILY);
    expect(genEnv.PROMPT_FAMILY).not.toBe('ASSISTANT_CHAT');
    expect(genEnv.PRIMARY_MODEL_ID).toBe(chatEnv.PRIMARY_MODEL_ID);
    expect(genEnv.ASSISTANT_NAME).toBe(brand.assistantName);
    expect(genEnv.METADATA_RETRIEVAL_FUNCTION).toEqual({
      'Fn::GetAtt': [expect.stringMatching(/MetadataRetrievalFunction/), 'Arn'],
    });
  });

  test('eval response generator gets the chat tool dependencies', () => {
    const fns = Object.values(resourcesOfType(template, 'AWS::Lambda::Function'));
    const gen = generatorFunction(template);
    const env = gen.Properties.Environment.Variables;
    for (const key of ['KNOWLEDGE_BUCKET', 'EXCEL_INDEX_QUERY_FUNCTION', 'INDEX_REGISTRY_TABLE',
      'GUARDRAIL_ID', 'GUARDRAIL_VERSION', 'ORGANIZATION_NAME', 'SUPPORT_CONTACT', 'DOMAIN_CONTEXT', 'BRAND_TIMEZONE']) {
      expect(Object.keys(env)).toContain(key);
    }
    // Same ceiling as a chat turn: a full agent loop.
    expect(gen.Properties.Timeout).toBe(900);
  });

  test('save step passes failed_questions and no longer average_relevance', () => {
    const definition = JSON.stringify(
      Object.values(resourcesOfType(template, 'AWS::StepFunctions::StateMachine'))[0].Properties.DefinitionString,
    );
    expect(definition).toContain('failed_questions.$');
    expect(definition).not.toContain('average_relevance.$');
  });
});

// ─── Region independence & multiple stacks ────────────────────────────────────

describe('region independence', () => {
  let eu: Synthesized;
  beforeAll(() => {
    eu = synth({ region: 'eu-west-1', stackName: 'AbeAssistantStagingEnvironmentForTesting01' });
  });

  test('no us-east-1 literal in IAM policies or Lambda environment outside us-east-1', () => {
    const json = eu.template.toJSON().Resources as Record<string, any>;
    for (const [id, res] of Object.entries(json)) {
      if (res.Type === 'AWS::IAM::Policy' || res.Type === 'AWS::IAM::Role') {
        expect({ id, hit: JSON.stringify(res.Properties).includes('us-east-1') }).toEqual({ id, hit: false });
      }
      if (res.Type === 'AWS::Lambda::Function') {
        const env = JSON.stringify(res.Properties.Environment ?? {});
        expect({ id, hit: env.includes('us-east-1') }).toEqual({ id, hit: false });
      }
    }
  });

  test('model defaults use the region\'s inference-profile prefix', () => {
    eu.template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ PRIMARY_MODEL_ID: 'eu.anthropic.claude-opus-4-6-v1' }) },
    });
  });

  test('CloudFront WAF only in us-east-1', () => {
    eu.template.resourceCountIs('AWS::WAFv2::WebACL', 0);
    const { template: us } = synth({ region: 'us-east-1' });
    us.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  test('long stack name synthesizes without nag errors and within name limits', () => {
    expect(nagErrors(eu.stack)).toEqual([]);
    const collection = Object.values(resourcesOfType(eu.template, 'AWS::OpenSearchServerless::Collection'))[0];
    expect(collection.Properties.Name.length).toBeLessThanOrEqual(32);
    const policies = [
      ...Object.values(resourcesOfType(eu.template, 'AWS::OpenSearchServerless::SecurityPolicy')),
      ...Object.values(resourcesOfType(eu.template, 'AWS::OpenSearchServerless::AccessPolicy')),
    ];
    for (const p of policies) {
      expect(p.Properties.Name.length).toBeLessThanOrEqual(32);
    }
    for (const s of Object.values(resourcesOfType(eu.template, 'AWS::Scheduler::Schedule'))) {
      expect(s.Properties.Name.length).toBeLessThanOrEqual(64);
    }
  });

  test('two stacks in one account get distinct OpenSearch names', () => {
    const names = (t: Template) => [
      ...Object.values(resourcesOfType(t, 'AWS::OpenSearchServerless::Collection')),
      ...Object.values(resourcesOfType(t, 'AWS::OpenSearchServerless::SecurityPolicy')),
      ...Object.values(resourcesOfType(t, 'AWS::OpenSearchServerless::AccessPolicy')),
    ].map((r) => r.Properties.Name as string);
    const a = names(synth({ stackName: 'AbeAssistantStagingEnvironmentForTesting02' }).template);
    const b = names(eu.template);
    for (const name of a) {
      expect(b).not.toContain(name);
    }
  });

  test('default stack keeps its original OpenSearch collection name', () => {
    const { template: t } = synth({ stackName: 'ABEStack' });
    t.hasResourceProperties('AWS::OpenSearchServerless::Collection', { Name: 'abestack-oss-collection' });
  });
});

// ─── Lambda functions ─────────────────────────────────────────────────────────

describe('Lambda functions', () => {
  test('Node functions use nodejs22.x on ARM64', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      Architectures: ['arm64'],
    });
    template.resourcePropertiesCountIs('AWS::Lambda::Function', { Runtime: 'nodejs20.x' }, 0);
  });

  test('WebSocket authorizer uses the shared Lambda defaults', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ APP_CLIENT_ID: Match.anyValue() }) },
      Architectures: ['arm64'],
      TracingConfig: { Mode: 'Active' },
    });
  });

  test('chat handler has a 15-minute timeout and 512 MB', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 900,
      MemorySize: 512,
    });
  });

  test('metadata handler has no reserved concurrency unless opted in', () => {
    template.resourcePropertiesCountIs('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: Match.anyValue(),
    }, 0);
    const { template: t } = synth({ context: { metadataHandlerConcurrency: '5' } });
    t.hasResourceProperties('AWS::Lambda::Function', { ReservedConcurrentExecutions: 5 });
  });

  test('staged Lambda assets contain no symlinks (shared code is copied in)', () => {
    // Node Lambdas share modules by symlink (shared-node/auth.mjs, the eval
    // generator's chat -> websocket-chat). A symlink left in the package
    // would point outside it once deployed.
    const outdir = (defaults.stack.node.root as cdk.App).synth().directory;
    const symlinks: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) symlinks.push(path.relative(outdir, full));
        else if (entry.isDirectory()) walk(full);
      }
    };
    const assetDirs = fs.readdirSync(outdir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('asset.'));
    expect(assetDirs.length).toBeGreaterThan(10);
    for (const dir of assetDirs) walk(path.join(outdir, dir.name));
    expect(symlinks).toEqual([]);
  });

  test('Lambdas that format times get BRAND_TIMEZONE', () => {
    const withTz = Object.values(resourcesOfType(template, 'AWS::Lambda::Function'))
      .filter((f) => f.Properties.Environment?.Variables?.BRAND_TIMEZONE);
    // chat, eval generator, metrics handler, sync schedule
    expect(withTz.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Storage ──────────────────────────────────────────────────────────────────

describe('storage', () => {
  test('core DynamoDB tables keep their key schemas', () => {
    const schemas: Array<[string, string]> = [
      ['user_id', 'session_id'],
      ['Topic', 'CreatedAt'],
      ['pk', 'sk'],
      ['PromptFamily', 'VersionId'],
      ['PartitionKey', 'Timestamp'],
      ['EvaluationId', 'QuestionId'],
      ['topic', 'timestamp'],
    ];
    for (const [hash, range] of schemas) {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: hash, KeyType: 'HASH' },
          { AttributeName: range, KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });
    }
  });

  test('all tables have point-in-time recovery', () => {
    const tables = resourcesOfType(template, 'AWS::DynamoDB::Table');
    const withPitr = template.findResources('AWS::DynamoDB::Table', {
      Properties: { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } },
    });
    expect(Object.keys(withPitr).length).toBe(Object.keys(tables).length);
  });

  test('AnalyticsTable has no AgencyIndex', () => {
    const json = JSON.stringify(resourcesOfType(template, 'AWS::DynamoDB::Table'));
    expect(json).not.toContain('AgencyIndex');
  });

  test('every bucket blocks public access', () => {
    const buckets = resourcesOfType(template, 'AWS::S3::Bucket');
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  test('feedback DLQ has an alarm', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
    });
  });

  test('chat session-save failures have an alarm on the namespace the chat Lambda uses', () => {
    const chat = chatFunction(template);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'SessionSaveFailures',
      Namespace: chat.Properties.Environment.Variables.METRICS_NAMESPACE,
      Threshold: 1,
    });
  });
});

// ─── CloudFront ───────────────────────────────────────────────────────────────

describe('CloudFront', () => {
  test('security headers policy with HSTS, nosniff, DENY and report-only CSP', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ Override: true }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: Match.objectLike({ Override: true }),
        }),
        CustomHeadersConfig: {
          Items: [Match.objectLike({ Header: 'Content-Security-Policy-Report-Only' })],
        },
      }),
    });
  });

  test('S3 origin uses origin access control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
  });
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

describe('tags', () => {
  test('generic Project / ManagedBy / Environment tags', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        { Key: 'Environment', Value: Match.anyValue() },
        { Key: 'ManagedBy', Value: 'cdk' },
        { Key: 'Project', Value: brand.slug },
      ]),
    });
    expect(JSON.stringify(template.toJSON())).not.toContain('"Owner"');
  });
});
