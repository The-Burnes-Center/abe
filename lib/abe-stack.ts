import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NagSuppressions } from 'cdk-nag';
import { NODE_RUNTIME, PYTHON_RUNTIME } from './shared/lambda-defaults';
import { ChatBotApi } from "./chatbot-api";
import { AuthorizationStack } from "./authorization";
import { UserInterface } from "./user-interface";
import { readDeploymentConfig } from "./deployment-config";
import { brand } from "../config/brand";

export class ABEStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = readDeploymentConfig(this.node);

    // CloudFront is created inside UserInterface (after ChatBotApi), so its domain isn't known
    // when the auth construct and ChatBotApi are built. Defer the site URL with a Lazy token
    // that resolves at synth, once the distribution exists. It feeds the HTTP API + S3 CORS
    // origin and the link in the Cognito invitation email.
    const siteUrlRef = { value: '*' };
    const siteUrl = cdk.Lazy.string({ produce: () => siteUrlRef.value });

    const authentication = new AuthorizationStack(this, "Authorization", {
      allowedSignupDomains: config.allowedSignupDomains,
      featurePlan: config.cognitoFeaturePlan,
      siteUrl,
    });

    const chatbotAPI = new ChatBotApi(this, "ChatbotAPI", {
      authentication,
      alarmEmail: config.alarmEmail,
      allowedOrigins: [siteUrl, ...config.devCorsOrigins],
      enableEval: config.enableEval,
      kbParserModel: config.kbParserModel,
      apiGatewayAccountRole: config.apiGatewayAccountRole,
      metadataHandlerConcurrency: config.metadataHandlerConcurrency,
    });
    const userInterface = new UserInterface(this, "UserInterface", {
      userPoolId: authentication.userPool.userPoolId,
      userPoolClientId: authentication.userPoolClient.userPoolClientId,
      selfSignUpEnabled: authentication.selfSignUpEnabled,
      evalEnabled: config.enableEval,
      api: chatbotAPI,
      customDomain: config.customDomain,
      certificateArn: config.certificateArn,
    });
    // Populate after construction; the Lazy producer reads this during app.synth().
    siteUrlRef.value = config.customDomain
      ? `https://${config.customDomain}`
      : `https://${userInterface.distribution.distributionDomainName}`;

    // Stable, top-level output keys for scripts (scripts/create-admin.sh reads UserPoolId).
    new cdk.CfnOutput(this, 'UserPoolId', { value: authentication.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: authentication.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'AppUrl', { value: siteUrl });

    // Resource tags applied to every taggable resource in the stack. The
    // OpenSearch collection is excluded: tag changes on an existing collection
    // surface as a replacement in the change set.
    const tagOpts = {
      excludeResourceTypes: ['AWS::OpenSearchServerless::Collection'],
    };
    cdk.Tags.of(this).add('Project', brand.slug, tagOpts);
    cdk.Tags.of(this).add('Environment', process.env.ENVIRONMENT || 'dev', tagOpts);
    cdk.Tags.of(this).add('ManagedBy', 'cdk', tagOpts);

    this.addNagSuppressions();
  }

  /**
   * Stack-wide suppressions are limited to findings scoped with `appliesTo`
   * (specific managed policies or wildcard resource patterns). Findings that
   * apply to a whole resource are suppressed on that resource, next to it.
   */
  private addNagSuppressions() {
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole is required for all Lambda functions to write logs to CloudWatch.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'X-Ray (PutTraceSegments/PutTelemetryRecords) and Transcribe streaming have no resource-level ARNs and require Resource::*.',
        appliesTo: ['Resource::*'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'S3 object-level operations require the /* suffix. Actions are scoped to specific buckets created by this stack.',
        appliesTo: [{ regex: '/^Resource::<.*Bucket.*\\.Arn>\\/.*$/' }],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'DynamoDB GSI access requires the /index/* suffix. Actions are scoped to specific tables created by this stack.',
        appliesTo: [{ regex: '/^Resource::<.*Table.*\\.Arn>\\/index\\/\\*$/' }],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Bedrock model wildcards cover cross-region/global inference profiles (which route to any region) and allow model upgrades without IAM changes.',
        appliesTo: [
          'Resource::arn:<AWS::Partition>:bedrock:*::foundation-model/anthropic.*',
          'Resource::arn:<AWS::Partition>:bedrock:*::foundation-model/amazon.titan-embed-*',
          'Resource::arn:<AWS::Partition>:bedrock:*:<AWS::AccountId>:inference-profile/*',
        ],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'An opt-in KB parser inference profile (-c kbParserModel=<geo>.<model>) routes to its model in any region of the profile, so the underlying foundation-model grant needs a region wildcard. The model id itself is fixed.',
        appliesTo: [{ regex: '/^Resource::arn:<AWS::Partition>:bedrock:\\*::foundation-model\\/[A-Za-z0-9.:-]+$/' }],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'WebSocket connection management requires @connections/* to send messages to any connected client of this API.',
        appliesTo: [{ regex: '/^Resource::arn:.+:execute-api:.+:<.*WSAPI.*>\\/\\*\\/\\*\\/@connections\\/\\*$/' }],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'CDK BucketDeployment and custom resources require broad S3 actions; these are CDK-managed constructs.',
        appliesTo: [
          'Action::s3:GetBucket*',
          'Action::s3:GetObject*',
          'Action::s3:List*',
          'Action::s3:Abort*',
          'Action::s3:DeleteObject*',
          { regex: '/^Resource::arn:.+:s3:::cdk-[a-z0-9]+-assets-[^/]+\\/\\*$/' },
        ],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'grantInvoke and Step Functions LambdaInvoke add <function-arn>:* so versions and aliases of that one function can be invoked.',
        appliesTo: [{ regex: '/^Resource::<.*Function.*\\.Arn>:\\*$/' }],
      },
    ]);
    this.suppressRuntimeFindings();
  }

  /**
   * AwsSolutions-L1 flags any runtime older than the newest one. Application
   * functions are pinned on purpose (NODE_RUNTIME / PYTHON_RUNTIME in
   * lib/shared/lambda-defaults.ts, matched to the bundling images and CI) and
   * upgraded deliberately; CDK's own helper functions are versioned by CDK.
   * Suppressions are attached per function rather than stack-wide.
   */
  private suppressRuntimeFindings() {
    const pinned = new Set([NODE_RUNTIME.name, PYTHON_RUNTIME.name]);
    for (const node of this.node.findAll()) {
      if (!(node instanceof lambda.CfnFunction)) continue;
      if (node.node.path.includes('/Custom::CDK')) {
        NagSuppressions.addResourceSuppressions(node, [{
          id: 'AwsSolutions-L1',
          reason: 'CDK-managed helper function (e.g. BucketDeployment); its runtime is controlled by aws-cdk-lib.',
        }]);
      } else if (node.runtime && pinned.has(node.runtime)) {
        NagSuppressions.addResourceSuppressions(node, [{
          id: 'AwsSolutions-L1',
          reason: `Runtime ${node.runtime} is pinned in lib/shared/lambda-defaults.ts and upgraded deliberately with the bundling images and CI.`,
        }]);
      }
    }
  }
}
