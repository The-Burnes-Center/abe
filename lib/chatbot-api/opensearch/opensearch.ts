import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';

import { Construct } from "constructs";
import { aws_opensearchserverless as opensearchserverless } from 'aws-cdk-lib';
import { boundedName, shortHash } from '../../shared/names';

// OpenSearch Serverless names: 3-32 chars, lowercase letters, digits and hyphens.
const AOSS_NAME_MAX = 32;
// Longest policy suffix is "-oss-network-policy" (19 chars), leaving 13 for the prefix.
const POLICY_PREFIX_MAX = 10;

export interface OpenSearchStackProps {}

export class OpenSearchStack extends Construct {

  public readonly openSearchCollection: opensearchserverless.CfnCollection;
  public readonly collectionName: string;
  public readonly knowledgeBaseRole: iam.Role;
  public readonly lambdaCustomResource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    // Physical names are unique per account+region, so they derive from the
    // stack name. Short stack names (e.g. the default "ABEStack") keep their
    // original names; longer ones are truncated with a hash so two stacks in
    // one account never collide and every name stays within AOSS limits.
    const baseName = stack.stackName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const prefix = baseName.length <= POLICY_PREFIX_MAX
      ? baseName
      : `${baseName.slice(0, 6)}-${shortHash(baseName)}`;

    // Resources use `scope` (not `this`) to preserve existing CloudFormation
    // logical IDs. Switching to `this` would change IDs and recreate resources.

    this.collectionName = boundedName(baseName, '-oss-collection', AOSS_NAME_MAX);
    const openSearchCollection = new opensearchserverless.CfnCollection(scope, 'OpenSearchCollection', {
      name: this.collectionName,
      description: `OpenSearch Serverless Collection for ${stack.stackName}`,
      standbyReplicas: 'DISABLED',
      type: 'VECTORSEARCH',
    });

    const encPolicy = new opensearchserverless.CfnSecurityPolicy(scope, 'OSSEncryptionPolicy', {
      name: `${prefix}-oss-enc-policy`,
      policy: `{"Rules":[{"ResourceType":"collection","Resource":["collection/${this.collectionName}"]}],"AWSOwnedKey":true}`,
      type: 'encryption',
    });

    // AllowFromPublic is required: Bedrock Knowledge Base accesses OpenSearch Serverless
    // from AWS-managed infrastructure (not from a Lambda in this account). There is no
    // VPC in this stack, and Bedrock does not support VPC endpoint-only AOSS access in
    // this configuration. Data-plane access is controlled by the IAM data access policy
    // below — only specific roles can read/write the collection.
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(scope, "OSSNetworkPolicy", {
      name: `${prefix}-oss-network-policy`,
      type: "network",
      policy: `[{"Rules":[{"ResourceType":"dashboard","Resource":["collection/${this.collectionName}"]},{"ResourceType":"collection","Resource":["collection/${this.collectionName}"]}],"AllowFromPublic":true}]`,
    });

    const indexFunctionRole = new iam.Role(scope, 'IndexFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    const knowledgeBaseRole = new iam.Role(scope, "KnowledgeBaseRole", {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    });

    this.knowledgeBaseRole = knowledgeBaseRole;

    const accessPolicy = new opensearchserverless.CfnAccessPolicy(scope, "OSSAccessPolicy", {
      name: `${prefix}-oss-access-policy`,
      type: "data",
      policy: JSON.stringify([
        {
          "Rules": [
            {
              "ResourceType": "index",
              "Resource": [`index/${this.collectionName}/*`],
              "Permission": [
                "aoss:UpdateIndex",
                "aoss:DescribeIndex",
                "aoss:ReadDocument",
                "aoss:WriteDocument",
                "aoss:CreateIndex",
              ],
            },
            {
              "ResourceType": "collection",
              "Resource": [`collection/${this.collectionName}`],
              "Permission": [
                "aoss:DescribeCollectionItems",
                "aoss:CreateCollectionItems",
                "aoss:UpdateCollectionItems",
              ],
            },
          ],
          "Principal": [indexFunctionRole.roleArn, knowledgeBaseRole.roleArn],
        },
      ]),
    });

    openSearchCollection.addDependency(encPolicy);
    openSearchCollection.addDependency(networkPolicy);
    openSearchCollection.addDependency(accessPolicy);

    this.openSearchCollection = openSearchCollection;

    const openSearchCreateIndexFunction = new lambda.Function(scope, 'OpenSearchCreateIndexFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.join(__dirname, 'create-index-lambda'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output',
          ],
        },
      }),
      handler: 'lambda_function.lambda_handler',
      role: indexFunctionRole,
      environment: {
        COLLECTION_ENDPOINT: `${openSearchCollection.attrId}.${stack.region}.aoss.amazonaws.com`,
        INDEX_NAME: 'knowledge-base-index',
        EMBEDDING_DIM: '1024',
        REGION: stack.region,
      },
      timeout: cdk.Duration.seconds(120),
    });

    indexFunctionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollection.attrArn],
    }));

    const lambdaProvider = new cr.Provider(scope, "CreateIndexFunctionCustomProvider", {
      onEventHandler: openSearchCreateIndexFunction,
    });

    const lambdaCustomResource = new cdk.CustomResource(scope, "CreateIndexFunctionCustomResource", {
      serviceToken: lambdaProvider.serviceToken,
    });

    this.lambdaCustomResource = lambdaCustomResource;
  }
}