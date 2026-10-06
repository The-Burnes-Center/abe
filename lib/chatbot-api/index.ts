import * as cdk from "aws-cdk-lib";
import { AuthorizationStack } from '../authorization'
import { WebsocketBackendAPI } from "./gateway/websocket-api"
import { RestBackendAPI } from "./gateway/rest-api"
import { LambdaFunctionStack } from "./functions/functions"
import { EvalFunctions } from "./functions/eval-functions"
import { TableStack } from "./tables/tables"
import { S3BucketStack } from "./buckets/buckets"
import { WebSocketLambdaIntegration, HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { WebSocketLambdaAuthorizer, HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { aws_apigatewayv2 as apigwv2 } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { OpenSearchStack } from "./opensearch/opensearch";
import { KnowledgeBaseStack } from "./knowledge-base/knowledge-base"
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { MonitoringConstruct } from "./monitoring/monitoring";

export interface ChatBotApiProps {
  readonly authentication: AuthorizationStack;
  readonly alarmEmail?: string;
  /** CORS origins for the HTTP API and S3 buckets (site URL, plus dev origins if configured). */
  readonly allowedOrigins: string[];
  /** Create the RAGAS evaluation pipeline, its storage and its admin routes. */
  readonly enableEval: boolean;
  /** Optional foundation-model parser for the knowledge base (see KnowledgeBaseStack). */
  readonly kbParserModel?: string;
  /**
   * Manage the region-wide API Gateway CloudWatch Logs role (AWS::ApiGateway::Account).
   * It is a per-region singleton: only one stack per account+region should own it.
   */
  readonly apiGatewayAccountRole: boolean;
  readonly metadataHandlerConcurrency?: number;
}

type Method = apigwv2.HttpMethod;
const { GET, POST, PUT, DELETE } = apigwv2.HttpMethod;

export class ChatBotApi extends Construct {
  public readonly httpAPI: RestBackendAPI;
  public readonly wsAPI: WebsocketBackendAPI;

  constructor(scope: Construct, id: string, props: ChatBotApiProps) {
    super(scope, id);

    // CORS is configured at the HTTP API gateway level via corsPreflight, pinned to allowedOrigins.
    // No OPTIONS handler needed; the gateway answers CORS preflight itself.

    const tables = new TableStack(this, "TableStack", props.enableEval);
    const buckets = new S3BucketStack(this, "BucketStack", props.allowedOrigins, props.enableEval);

    const openSearch = new OpenSearchStack(this, "OpenSearchStack", {})
    const knowledgeBase = new KnowledgeBaseStack(this, "KnowledgeBaseStack", {
      openSearch: openSearch,
      s3bucket: buckets.knowledgeBucket,
      supplementalBucket: buckets.knowledgeBaseSupplementalBucket,
      parserModelId: props.kbParserModel,
    })

    const restBackend = new RestBackendAPI(this, "RestBackend", { allowedOrigins: props.allowedOrigins })
    this.httpAPI = restBackend;
    const websocketBackend = new WebsocketBackendAPI(this, "WebsocketBackend", {})
    this.wsAPI = websocketBackend;

    if (props.apiGatewayAccountRole) {
      // Stage access logging needs an account-level CloudWatch Logs role. A fresh
      // account has none, so the first stack in a region creates it. A second stack
      // in the same account+region should deploy with -c apiGatewayAccountRole=false,
      // otherwise the two stacks overwrite each other's setting and deleting one
      // breaks logging for the other.
      const apiGwLogRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
        assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
        ],
      });
      NagSuppressions.addResourceSuppressions(apiGwLogRole, [{
        id: 'AwsSolutions-IAM4',
        reason: 'AmazonAPIGatewayPushToCloudWatchLogs is the AWS-managed policy API Gateway requires for access logging.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'],
      }]);
      const apiGwAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
        cloudWatchRoleArn: apiGwLogRole.roleArn,
      });
      // Stages must wait for the account-level role before enabling access logging.
      restBackend.restAPI.defaultStage!.node.addDependency(apiGwAccount);
      websocketBackend.wsAPIStage.node.addDependency(apiGwAccount);
    }

    const lambdaFunctions = new LambdaFunctionStack(this, "LambdaFunctions", {
      wsApiEndpoint: websocketBackend.wsAPIStage.url,
      sessionTable: tables.historyTable,
      feedbackTable: tables.feedbackTable,
      feedbackRecordsTable: tables.feedbackRecordsTable,
      responseTraceTable: tables.responseTraceTable,
      promptRegistryTable: tables.promptRegistryTable,
      monitoringCasesTable: tables.monitoringCasesTable,
      feedbackBucket: buckets.feedbackBucket,
      knowledgeBucket: buckets.knowledgeBucket,
      knowledgeBase: knowledgeBase.knowledgeBase,
      knowledgeBaseSource: knowledgeBase.dataSource,
      analyticsTable: tables.analyticsTable,
      contractIndexBucket: buckets.contractIndexBucket,
      excelIndexDataTable: tables.excelIndexDataTable,
      indexRegistryTable: tables.indexRegistryTable,
      dataStagingBucket: buckets.dataStagingBucket,
      syncHistoryTable: tables.syncHistoryTable,
      userPool: props.authentication.userPool,
      feedbackToTestLibraryQueue: tables.feedbackToTestLibraryQueue,
      metadataHandlerConcurrency: props.metadataHandlerConcurrency,
    });

    const evalFunctions = props.enableEval
      ? new EvalFunctions(this, "EvalFunctions", {
          pythonCommonLayer: lambdaFunctions.pythonCommonLayer,
          knowledgeBase: knowledgeBase.knowledgeBase,
          promptRegistryTable: tables.promptRegistryTable,
          metadataRetrievalFunction: lambdaFunctions.metadataRetrievalFunction,
          evalSummariesTable: tables.evalSummaryTable!,
          evalResultsTable: tables.evalResultsTable!,
          testLibraryTable: tables.testLibraryTable!,
          evalTestCasesBucket: buckets.evalTestCasesBucket!,
          evalResultsBucket: buckets.evalResultsBucket!,
          feedbackToTestLibraryQueue: tables.feedbackToTestLibraryQueue!,
          models: lambdaFunctions.models,
          knowledgeBucket: buckets.knowledgeBucket,
          excelIndexQueryFunction: lambdaFunctions.excelIndexQueryFunction,
          indexRegistryTable: tables.indexRegistryTable,
        })
      : undefined;

    // ─── WebSocket API ───
    // Only $connect is authorized (Cognito ID token in the query string, checked by
    // the Lambda authorizer). Later frames travel on that authenticated connection,
    // and API Gateway does not run authorizers on non-$connect routes.
    const wsAuthorizer = new WebSocketLambdaAuthorizer('WebSocketAuthorizer', props.authentication.lambdaAuthorizer, {
      identitySource: ['route.request.querystring.Authorization'],
    });
    websocketBackend.wsAPI.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('chatbotConnectionIntegration', lambdaFunctions.chatFunction),
      authorizer: wsAuthorizer,
    });
    const connectionRoutes = [
      websocketBackend.wsAPI.addRoute('getChatbotResponse', {
        integration: new WebSocketLambdaIntegration('chatbotResponseIntegration', lambdaFunctions.chatFunction),
      }),
      websocketBackend.wsAPI.addRoute('$default', {
        integration: new WebSocketLambdaIntegration('chatbotConnectionIntegration', lambdaFunctions.chatFunction),
      }),
      websocketBackend.wsAPI.addRoute('$disconnect', {
        integration: new WebSocketLambdaIntegration('chatbotDisconnectionIntegration', lambdaFunctions.chatFunction),
      }),
    ];
    for (const route of connectionRoutes) {
      NagSuppressions.addResourceSuppressions(route, [{
        id: 'AwsSolutions-APIG4',
        reason: 'WebSocket APIs authorize on $connect only; this route runs on an already-authorized connection.',
      }]);
    }
    websocketBackend.wsAPI.grantManageConnections(lambdaFunctions.chatFunction);

    // Lambdas the chat handler invokes directly.
    lambdaFunctions.chatFunction.addEnvironment("SESSION_HANDLER", lambdaFunctions.sessionFunction.functionName);
    lambdaFunctions.chatFunction.addEnvironment("FAQ_CLASSIFIER_FUNCTION", lambdaFunctions.faqClassifierFunction.functionName);
    lambdaFunctions.chatFunction.addEnvironment("CONTEXT_SUMMARIZER_FUNCTION", lambdaFunctions.contextSummarizerFunction.functionName);
    lambdaFunctions.chatFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        lambdaFunctions.faqClassifierFunction.functionArn,
        lambdaFunctions.contextSummarizerFunction.functionArn,
      ],
    }));

    // ─── HTTP API ───
    // Every route uses the Cognito JWT authorizer. Admin-only routes are
    // additionally checked inside each handler against the `cognito:groups` claim.
    const httpAuthorizer = new HttpJwtAuthorizer('HTTPAuthorizer', props.authentication.userPool.userPoolProviderUrl, {
      jwtAudience: [props.authentication.userPoolClient.userPoolClientId],
    });
    const addRoutes = (integration: HttpLambdaIntegration, routes: Array<[string, Method[]]>) => {
      for (const [path, methods] of routes) {
        restBackend.restAPI.addRoutes({ path, methods, integration, authorizer: httpAuthorizer });
      }
    };
    const integrationFor = (name: string, fn: lambda.IFunction) => new HttpLambdaIntegration(name, fn);

    addRoutes(integrationFor('SessionAPIIntegration', lambdaFunctions.sessionFunction), [
      ["/user-session", [GET, POST, DELETE]],
    ]);

    addRoutes(integrationFor('FeedbackDownloadAPIIntegration', lambdaFunctions.feedbackFunction), [
      ["/user-feedback/download-feedback", [POST]],
    ]);
    addRoutes(integrationFor('FeedbackAPIIntegration', lambdaFunctions.feedbackFunction), [
      ["/user-feedback", [GET, POST, DELETE]],
      ["/feedback", [POST]],
      ["/feedback/{feedbackId}/follow-up", [POST]],
      ["/admin/feedback", [GET]],
      ["/admin/feedback/{feedbackId}", [GET, DELETE]],
      ["/admin/feedback/{feedbackId}/analyze", [POST]],
      ["/admin/feedback/{feedbackId}/disposition", [POST]],
      ["/admin/feedback/{feedbackId}/promote-to-candidate", [POST]],
      ["/admin/prompts", [GET, POST]],
      ["/admin/prompts/{versionId}", [GET, PUT, DELETE]],
      ["/admin/prompts/{versionId}/publish", [POST]],
      ["/admin/prompts/{versionId}/ai-suggest", [POST]],
      ["/admin/monitoring", [GET]],
      ["/admin/activity-log", [GET]],
    ]);

    addRoutes(integrationFor('S3GetAPIIntegration', lambdaFunctions.getS3Function), [["/s3-bucket-data", [POST]]]);
    addRoutes(integrationFor('S3DeleteAPIIntegration', lambdaFunctions.deleteS3Function), [["/delete-s3-file", [POST]]]);
    addRoutes(integrationFor('S3UploadAPIIntegration', lambdaFunctions.uploadS3Function), [["/signed-url", [POST]]]);

    addRoutes(integrationFor('KBSyncAPIIntegration', lambdaFunctions.syncKBFunction), [
      ["/kb-sync/still-syncing", [GET]],
      ["/kb-sync/sync-kb", [GET]],
    ]);
    addRoutes(integrationFor('KBLastSyncAPIIntegration', lambdaFunctions.syncKBFunction), [
      ["/kb-sync/get-last-sync", [GET]],
    ]);

    addRoutes(integrationFor('ExcelIndexAPIIntegration', lambdaFunctions.excelIndexApiFunction), [
      ["/admin/indexes", [GET, POST]],
      ["/admin/indexes/{indexId}/status", [GET]],
      ["/admin/indexes/{indexId}/preview", [GET]],
      ["/admin/indexes/{indexId}/upload-url", [POST]],
      ["/admin/indexes/{indexId}", [DELETE, PUT]],
    ]);

    addRoutes(integrationFor('SyncScheduleIntegration', lambdaFunctions.syncScheduleFunction), [
      ["/admin/sync-schedule", [GET, PUT]],
      ["/admin/sync-destinations", [GET]],
      ["/admin/sync-history", [GET]],
    ]);
    addRoutes(integrationFor('SyncOrchestratorIntegration', lambdaFunctions.syncScheduleFunction), [
      ["/admin/sync-now", [POST]],
    ]);

    addRoutes(integrationFor('UserAdminIntegration', lambdaFunctions.userAdminFunction), [
      ["/admin/users", [GET, POST]],
      ["/admin/users/{username}", [DELETE]],
      ["/admin/users/{username}/admin", [POST]],
      ["/admin/users/{username}/disable", [POST]],
      ["/admin/users/{username}/enable", [POST]],
      ["/admin/users/{username}/resend-invite", [POST]],
    ]);

    addRoutes(integrationFor('MetricsHandlerIntegration', lambdaFunctions.metricsHandlerFunction), [["/metrics", [GET]]]);
    addRoutes(integrationFor('SourcePresignIntegration', lambdaFunctions.sourcePresignFunction), [["/source-presign", [POST]]]);
    // Live dictation: hands the chat input a short-lived presigned Amazon
    // Transcribe streaming WebSocket URL (audio streams browser -> Transcribe).
    addRoutes(integrationFor('TranscribePresignIntegration', lambdaFunctions.transcribePresignFunction), [
      ["/transcribe-stream-url", [GET]],
    ]);

    if (evalFunctions) {
      addRoutes(integrationFor('EvalResultsHandlerIntegration', evalFunctions.handleEvalResultsFunction), [
        ["/eval-results-handler", [POST]],
      ]);
      addRoutes(integrationFor('EvalRunHandlerIntegration', evalFunctions.stepFunctionsStack.startLlmEvalStateMachineFunction), [
        ["/eval-run-handler", [POST]],
      ]);
      addRoutes(integrationFor('S3UploadTestCasesAPIIntegration', evalFunctions.uploadS3TestCasesFunction), [
        ["/signed-url-test-cases", [POST]],
      ]);
      addRoutes(integrationFor('S3GetTestCasesAPIIntegration', evalFunctions.getS3TestCasesFunction), [
        ["/s3-test-cases-bucket-data", [POST]],
      ]);
      addRoutes(integrationFor('TestLibraryIntegration', evalFunctions.testLibraryFunction), [
        ["/test-library", [POST]],
      ]);
    }

    new MonitoringConstruct(this, "Monitoring", {
      lambdaFunctions: [
        lambdaFunctions.chatFunction,
        lambdaFunctions.sessionFunction,
        lambdaFunctions.feedbackFunction,
        lambdaFunctions.syncKBFunction,
        lambdaFunctions.metadataHandlerFunction,
        lambdaFunctions.metricsHandlerFunction,
        lambdaFunctions.deleteS3Function,
        lambdaFunctions.getS3Function,
        lambdaFunctions.uploadS3Function,
        lambdaFunctions.userAdminFunction,
        ...(evalFunctions ? [evalFunctions.handleEvalResultsFunction] : []),
      ],
      chatFunction: lambdaFunctions.chatFunction,
      preSignUpFunction: props.authentication.preSignUpFunction,
      tables: [
        tables.historyTable,
        tables.feedbackTable,
        tables.feedbackRecordsTable,
        tables.responseTraceTable,
        tables.promptRegistryTable,
        tables.monitoringCasesTable,
        tables.analyticsTable,
        ...(tables.evalSummaryTable ? [tables.evalSummaryTable] : []),
        ...(tables.evalResultsTable ? [tables.evalResultsTable] : []),
      ],
      restApi: restBackend.restAPI,
      webSocketApi: websocketBackend.wsAPI,
      evalStateMachine: evalFunctions?.stepFunctionsStack.llmEvalStateMachine,
      deadLetterQueue: tables.feedbackToTestLibraryDLQ,
      alarmEmail: props.alarmEmail,
    });

    new cdk.CfnOutput(this, "WS-API - apiEndpoint", {
      value: websocketBackend.wsAPI.apiEndpoint,
    });
    new cdk.CfnOutput(this, "HTTP-API - apiEndpoint", {
      value: restBackend.restAPI.apiEndpoint,
    });
  }
}
