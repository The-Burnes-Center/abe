/**
 * Lambda functions, event sources, and IAM policies for the chatbot.
 *
 * Functions are grouped by domain:
 *
 *   Chat (core conversation)
 *     - ChatHandlerFunction             — WebSocket chat handler (Node.js, agentic tool loop)
 *     - SessionHandlerFunction          — CRUD for chat sessions/history
 *     - MetadataRetrievalFunction       — Fetches metadata.txt from KB bucket (invoked by chat)
 *     - SourcePresignFunction           — Generates pre-signed S3 URLs for source citations
 *     - FAQClassifierFunction           — Classifies questions by topic for analytics
 *     - ContextSummarizerFunction       — Summarizes conversation context for long sessions
 *
 *   Knowledge Management
 *     - GetS3FilesHandlerFunction       — Lists/reads KB bucket contents for admin UI
 *     - UploadS3FilesHandlerFunction    — Handles admin file uploads to KB bucket
 *     - DeleteS3FilesHandlerFunction    — Handles admin file deletions from KB bucket
 *     - SyncKBHandlerFunction           — Triggers Bedrock KB ingestion job
 *     - MetadataHandlerFunction         — S3 event-driven: auto-generates metadata on upload/delete
 *
 *   Feedback
 *     - FeedbackHandlerFunction         — CRUD for feedback records + LLM analysis
 *
 *   Evaluation Pipeline (eval-functions.ts, only when enableEval is true)
 *
 *   Excel Index (excel-index-functions.ts, structured tabular data)
 *     - ExcelIndexParserFunction        — S3 event-driven: parses .xlsx into DynamoDB
 *     - ExcelIndexQueryFunction         — DynamoDB query engine (filters, counts, sorts)
 *     - ExcelIndexApiFunction           — REST API gateway for index management
 *
 *   Sync (sync-functions.ts)
 *     - SyncOrchestratorFunction, SyncScheduleFunction, weekly + hourly schedules
 *
 *   User administration
 *     - UserAdminFunction               — Admin-only invite/role/enable/disable/delete API
 *
 *   Metrics
 *     - MetricsHandlerFunction          — Reads session/analytics tables for admin dashboards
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import { S3EventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SyncFunctions } from './sync-functions';
import { ExcelIndexFunctions } from './excel-index-functions';
import { ADMIN_GROUP_NAME, BRAND_PROMPT_ENV, BRAND_TIMEZONE, PROMPT_FAMILY } from '../../constants';
import { anthropicInvokeResources, ModelIds, modelIds } from '../../shared/bedrock';
import { LAMBDA_DEFAULTS, NODE_RUNTIME, PYTHON_RUNTIME, pythonBundledCode, pythonCode } from '../../shared/lambda-defaults';

interface LambdaFunctionStackProps {
  readonly wsApiEndpoint: string;
  readonly sessionTable: Table;
  readonly feedbackTable: Table;
  readonly feedbackRecordsTable: Table;
  readonly responseTraceTable: Table;
  readonly promptRegistryTable: Table;
  readonly monitoringCasesTable: Table;
  readonly feedbackBucket: s3.Bucket;
  readonly knowledgeBucket: s3.Bucket;
  readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  readonly knowledgeBaseSource: bedrock.CfnDataSource;
  readonly analyticsTable: Table;
  readonly contractIndexBucket: s3.Bucket;
  readonly excelIndexDataTable: Table;
  readonly indexRegistryTable: Table;
  readonly dataStagingBucket: s3.Bucket;
  readonly syncHistoryTable: Table;
  readonly userPool: cognito.IUserPool;
  /** Present only when the eval pipeline is enabled; feedback promotion returns 503 without it. */
  readonly feedbackToTestLibraryQueue?: sqs.Queue;
  /** Optional reserved concurrency for the metadata handler (opt-in; new accounts have a quota of 10). */
  readonly metadataHandlerConcurrency?: number;
}

export class LambdaFunctionStack extends Construct {
  public readonly chatFunction: lambda.Function;
  public readonly sessionFunction: lambda.Function;
  public readonly feedbackFunction: lambda.Function;
  public readonly deleteS3Function: lambda.Function;
  public readonly getS3Function: lambda.Function;
  public readonly uploadS3Function: lambda.Function;
  public readonly syncKBFunction: lambda.Function;
  public readonly metadataHandlerFunction: lambda.Function;
  public readonly metricsHandlerFunction: lambda.Function;
  public readonly faqClassifierFunction: lambda.Function;
  public readonly contextSummarizerFunction: lambda.Function;
  public readonly excelIndexParserFunction: lambda.Function;
  public readonly excelIndexQueryFunction: lambda.Function;
  public readonly excelIndexApiFunction: lambda.Function;
  public readonly sourcePresignFunction: lambda.Function;
  public readonly transcribePresignFunction: lambda.Function;
  public readonly syncOrchestratorFunction: lambda.Function;
  public readonly syncScheduleFunction: lambda.Function;
  public readonly metadataRetrievalFunction: lambda.Function;
  public readonly userAdminFunction: lambda.Function;
  public readonly pythonCommonLayer: lambda.LayerVersion;
  public readonly models: ModelIds;

  constructor(scope: Construct, id: string, props: LambdaFunctionStackProps) {
    super(scope, id);

    // Resources use `scope` (not `this`) to preserve existing CloudFormation
    // logical IDs. Switching to `this` would change IDs and recreate functions.

    const models = modelIds(scope);
    this.models = models;

    // Shared Python layer: auth helpers, structured logging, JSON response builders.
    const pythonCommonLayer = new lambda.LayerVersion(scope, 'PythonCommonLayer', {
      code: pythonCode(path.join(__dirname, 'layers/python-common')),
      compatibleRuntimes: [PYTHON_RUNTIME],
      description: 'Shared Python utilities for Lambda handlers',
    });
    this.pythonCommonLayer = pythonCommonLayer;

    // ─── Chat Domain ────────────────────────────────────────────────────

    // Session CRUD: list, get, delete chat sessions for the sidebar.
    const sessionAPIHandlerFunction = new lambda.Function(scope, 'SessionHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'session-handler')),
      handler: 'lambda_function.lambda_handler',
      layers: [pythonCommonLayer],
      environment: {
        "DDB_TABLE_NAME": props.sessionTable.tableName,
        "METADATA_BUCKET": props.knowledgeBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    
    sessionAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.sessionTable.tableArn, props.sessionTable.tableArn + "/index/*", `${props.knowledgeBucket.bucketArn}/metadata.txt`]
    }));

    this.sessionFunction = sessionAPIHandlerFunction;

        // Core chat handler: receives WebSocket messages, runs the agentic
        // tool-use loop (query_db, query_excel_index, fetch_metadata, etc.),
        // and streams responses back. 512 MB memory for large KB retrieval
        // payloads. 5-min timeout accommodates multi-turn tool loops.
        const websocketAPIFunction = new lambda.Function(scope, 'ChatHandlerFunction', {
          ...LAMBDA_DEFAULTS,
          runtime: NODE_RUNTIME,
          code: lambda.Code.fromAsset(path.join(__dirname, 'websocket-chat')),
          handler: 'index.handler',
          memorySize: 512,
          environment: {
            "WEBSOCKET_API_ENDPOINT": props.wsApiEndpoint.replace("wss", "https"),
            'KB_ID': props.knowledgeBase.attrKnowledgeBaseId,
            'GUARDRAIL_ID': process.env.GUARDRAIL_ID || '',
            'GUARDRAIL_VERSION': process.env.GUARDRAIL_VERSION || '1',
            'PRIMARY_MODEL_ID': models.primary,
            'FAST_MODEL_ID': models.fast,
            'PROMPT_REGISTRY_TABLE': props.promptRegistryTable.tableName,
            'RESPONSE_TRACE_TABLE': props.responseTraceTable.tableName,
            'PROMPT_FAMILY': PROMPT_FAMILY,
            ...BRAND_PROMPT_ENV,
          },
          // 15 min is the AWS Lambda max. Long agentic loops (e.g. exhaustive
          // KB sweeps for "list all X" questions) can legitimately use most of
          // it. The API Gateway WebSocket idle timeout is 10 min, but the
          // chat handler streams status/text frames continuously, so the
          // socket stays alive throughout an active turn.
          timeout: cdk.Duration.minutes(15),
        });
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:InvokeModel',
          ],
          resources: anthropicInvokeResources()
        }));
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:Retrieve'
          ],
          resources: [props.knowledgeBase.attrKnowledgeBaseArn]
        }));

        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:InvokeFunction'
          ],
          resources: [this.sessionFunction.functionArn]
        }));

        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
          ],
          resources: [
            props.promptRegistryTable.tableArn,
            props.promptRegistryTable.tableArn + "/index/*",
            props.responseTraceTable.tableArn,
            props.responseTraceTable.tableArn + "/index/*",
          ]
        }));

        // The chat Lambda generates pre-signed S3 URLs for source links.
        // Pre-signed URLs require the signing IAM role to have s3:GetObject.
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
          ],
          resources: [props.knowledgeBucket.bucketArn + "/*"]
        }));

        this.chatFunction = websocketAPIFunction;

    // ─── Feedback Domain ─────────────────────────────────────────────────

    // Feedback CRUD, LLM-powered analysis, CSV export, and SQS enqueue
    // for the feedback-to-test-library pipeline. 256 MB for LLM payloads.
    const feedbackAPIHandlerFunction = new lambda.Function(scope, 'FeedbackHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'feedback-handler')),
      handler: 'lambda_function.lambda_handler',
      layers: [pythonCommonLayer],
      memorySize: 256,
      environment: {
        "FEEDBACK_TABLE": props.feedbackTable.tableName,
        "FEEDBACK_S3_DOWNLOAD": props.feedbackBucket.bucketName,
        "FEEDBACK_RECORDS_TABLE": props.feedbackRecordsTable.tableName,
        "RESPONSE_TRACE_TABLE": props.responseTraceTable.tableName,
        "PROMPT_REGISTRY_TABLE": props.promptRegistryTable.tableName,
        "MONITORING_CASES_TABLE": props.monitoringCasesTable.tableName,
        "PROMPT_FAMILY": PROMPT_FAMILY,
        "FEEDBACK_ANALYSIS_MODEL_ID": models.fast,
        "PROMPT_REWRITE_MODEL_ID": models.primary,
        "FEEDBACK_TO_TEST_LIBRARY_QUEUE_URL": props.feedbackToTestLibraryQueue?.queueUrl ?? "",
      },
      timeout: cdk.Duration.seconds(30),
    });
    
    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [
        props.feedbackTable.tableArn,
        props.feedbackTable.tableArn + "/index/*",
        props.feedbackRecordsTable.tableArn,
        props.feedbackRecordsTable.tableArn + "/index/*",
        props.responseTraceTable.tableArn,
        props.responseTraceTable.tableArn + "/index/*",
        props.promptRegistryTable.tableArn,
        props.promptRegistryTable.tableArn + "/index/*",
        props.monitoringCasesTable.tableArn,
        props.monitoringCasesTable.tableArn + "/index/*",
      ]
    }));

    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:ListBucket',
      ],
      resources: [props.feedbackBucket.bucketArn,props.feedbackBucket.bucketArn+"/*"]
    }));

    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: anthropicInvokeResources()
    }));

    if (props.feedbackToTestLibraryQueue) {
      feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [props.feedbackToTestLibraryQueue.queueArn],
      }));
    }

    this.feedbackFunction = feedbackAPIHandlerFunction;
    
    // ─── Knowledge Management Domain ──────────────────────────────────

    // Admin UI file operations on the Knowledge Base source bucket.
    const deleteS3APIHandlerFunction = new lambda.Function(scope, 'DeleteS3FilesHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'knowledge-management/delete-s3')),
      handler: 'lambda_function.lambda_handler',
      layers: [pythonCommonLayer],
      environment: {
        "BUCKET": props.knowledgeBucket.bucketName,
        // Used to remove a doc's chunks from the KB (DeleteKnowledgeBaseDocuments)
        // before deleting the S3 source, so the chatbot can't keep citing
        // a file an admin just removed.
        "KB_ID": props.knowledgeBase.attrKnowledgeBaseId,
        "DATA_SOURCE_ID": props.knowledgeBaseSource.attrDataSourceId,
      },
      timeout: cdk.Duration.seconds(30),
    });

    deleteS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:DeleteObject',
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));

    deleteS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:DeleteKnowledgeBaseDocuments',
        // DeleteKnowledgeBaseDocuments internally kicks off an ingestion job
        // to drop the doc's chunks from OpenSearch -- without this action
        // Bedrock returns AccessDeniedException for bedrock:StartIngestionJob
        // and the whole delete fails. Don't remove.
        'bedrock:StartIngestionJob',
      ],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn]
    }));
    this.deleteS3Function = deleteS3APIHandlerFunction;

    const getS3APIHandlerFunction = new lambda.Function(scope, 'GetS3FilesHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: NODE_RUNTIME,
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/get-s3')),
      handler: 'index.handler',
      environment: {
        "BUCKET": props.knowledgeBucket.bucketName,
        // Used to hydrate the per-document SyncStatus column in the admin
        // documents table via ListKnowledgeBaseDocuments.
        "KB_ID": props.knowledgeBase.attrKnowledgeBaseId,
        "DATA_SOURCE_ID": props.knowledgeBaseSource.attrDataSourceId,
      },
      timeout: cdk.Duration.seconds(30),
    });

    getS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));

    // Read-only access to KB metadata so the admin documents table can
    // show per-document sync status (synced / syncing / failed / not yet
    // synced). No write actions -- the sync orchestrator and kb-sync
    // Lambda are the only writers.
    getS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:ListKnowledgeBaseDocuments',
      ],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn]
    }));
    this.getS3Function = getS3APIHandlerFunction;


    const kbSyncAPIHandlerFunction = new lambda.Function(scope, 'SyncKBHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'knowledge-management/kb-sync')),
      handler: 'lambda_function.lambda_handler',
      layers: [pythonCommonLayer],
      environment: {
        "KB_ID": props.knowledgeBase.attrKnowledgeBaseId,
        "SOURCE": props.knowledgeBaseSource.attrDataSourceId,
      },
      timeout: cdk.Duration.seconds(30),
    });

    kbSyncAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
      ],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn]
    }));
    this.syncKBFunction = kbSyncAPIHandlerFunction;

    const uploadS3APIHandlerFunction = new lambda.Function(scope, 'UploadS3FilesHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: NODE_RUNTIME,
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/upload-s3')),
      handler: 'index.handler',
      environment: {
        "BUCKET": props.knowledgeBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    uploadS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.uploadS3Function = uploadS3APIHandlerFunction;





    // S3 event-driven: fires on every upload/delete in the KB bucket.
    // Regenerates metadata.txt (LLM-summarized file inventory) used by
    // the chat handler's fetch_metadata tool.
    const metadataHandlerFunction = new lambda.Function(scope, 'MetadataHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'metadata-handler')),
      handler: 'lambda_function.lambda_handler',
      layers: [pythonCommonLayer],
      timeout: cdk.Duration.seconds(30),
      // A backfill sweep or bulk sync can fire one async invocation per
      // document (200+ at once), each calling Bedrock. Optionally cap
      // concurrency (-c metadataHandlerConcurrency=5) so sweeps drain
      // gradually instead of tripping Bedrock throttles; the Lambda service
      // retries throttled async events. Off by default because reserving
      // concurrency fails in new accounts whose total quota is only 10.
      reservedConcurrentExecutions: props.metadataHandlerConcurrency,
      environment: {
        "BUCKET": props.knowledgeBucket.bucketName,
        "KB_ID": props.knowledgeBase.attrKnowledgeBaseId,
        "FAST_MODEL_ID": models.fast,
      },
    });



    // S3 permissions for metadata handler
    metadataHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        props.knowledgeBucket.bucketArn,
        props.knowledgeBucket.bucketArn + "/*",
      ]
    }));
    // Bedrock InvokeModel permission for metadata summarization
    metadataHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: anthropicInvokeResources()
    }));
    // Bedrock Retrieve permission for knowledge base
    metadataHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:Retrieve',
      ],
      resources: [
        props.knowledgeBase.attrKnowledgeBaseArn,
      ]
    }));


// Trigger the lambda function when a document is uploaded

    this.metadataHandlerFunction = metadataHandlerFunction;

      metadataHandlerFunction.addEventSource(new S3EventSource(props.knowledgeBucket, {
        events: [s3.EventType.OBJECT_CREATED, s3.EventType.OBJECT_REMOVED],
      }));

// Lightweight function that returns metadata.txt content; invoked by the
// chat Lambda as a tool call rather than reading S3 directly.
const metadataRetrievalFunction = new lambda.Function(scope, 'MetadataRetrievalFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: PYTHON_RUNTIME,
  code: pythonCode(path.join(__dirname, 'metadata-retrieval')),
  handler: 'lambda_function.lambda_handler',
  layers: [pythonCommonLayer],
  timeout: cdk.Duration.seconds(30),
  environment: {
    "BUCKET": props.knowledgeBucket.bucketName,
  },
});

metadataRetrievalFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['s3:GetObject'],
  resources: [`${props.knowledgeBucket.bucketArn}/metadata.txt`]
}));
this.metadataRetrievalFunction = metadataRetrievalFunction;

websocketAPIFunction.addEnvironment("METADATA_RETRIEVAL_FUNCTION", metadataRetrievalFunction.functionArn);
websocketAPIFunction.addEnvironment("KNOWLEDGE_BUCKET", props.knowledgeBucket.bucketName);
websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'lambda:InvokeFunction',
  ],
  resources: [
    metadataRetrievalFunction.functionArn,
  ],
}));

// ─── Metrics / Analytics Domain ──────────────────────────────────────

// Reads session and analytics tables for admin dashboard aggregations.
// 60s timeout: full-table scans can be slow on large datasets.
const metricsHandlerFunction = new lambda.Function(scope, 'MetricsHandlerFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: PYTHON_RUNTIME,
  code: pythonCode(path.join(__dirname, 'metrics-handler')),
  handler: 'lambda_function.lambda_handler',
  layers: [pythonCommonLayer],
  environment: {
    "DDB_TABLE_NAME": props.sessionTable.tableName,
    "ANALYTICS_TABLE_NAME": props.analyticsTable.tableName,
    BRAND_TIMEZONE,
  },
  timeout: cdk.Duration.seconds(60),
});

metricsHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'dynamodb:Scan',
    'dynamodb:Query',
  ],
  resources: [
    props.sessionTable.tableArn,
    props.sessionTable.tableArn + "/index/*",
    props.analyticsTable.tableArn,
    props.analyticsTable.tableArn + "/index/*",
  ]
}));

this.metricsHandlerFunction = metricsHandlerFunction;

// Classifies each user question by topic using the fast model.
// Results are written to the analytics table for dashboard reporting.
const faqClassifierFunction = new lambda.Function(scope, 'FAQClassifierFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: PYTHON_RUNTIME,
  code: pythonCode(path.join(__dirname, 'faq-classifier')),
  handler: 'lambda_function.lambda_handler',
  layers: [pythonCommonLayer],
  environment: {
    "ANALYTICS_TABLE_NAME": props.analyticsTable.tableName,
    "FAST_MODEL_ID": models.fast,
  },
  timeout: cdk.Duration.seconds(30),
});

faqClassifierFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: anthropicInvokeResources(),
}));

faqClassifierFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['dynamodb:PutItem'],
  resources: [props.analyticsTable.tableArn],
}));

this.faqClassifierFunction = faqClassifierFunction;

// Summarizes long conversation context to fit within the model's context
// window. Bundles its own Python dependencies (not in the common layer).
// 60s timeout: LLM summarization of large contexts can be slow.
const contextSummarizerFunction = new lambda.Function(scope, 'ContextSummarizerFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: PYTHON_RUNTIME,
  code: pythonBundledCode(path.join(__dirname, 'context-summarizer')),
  handler: 'lambda_function.lambda_handler',
  layers: [pythonCommonLayer],
  environment: {
    "FAST_MODEL_ID": models.fast,
  },
  timeout: cdk.Duration.seconds(60),
});

contextSummarizerFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: anthropicInvokeResources(),
}));

this.contextSummarizerFunction = contextSummarizerFunction;

// ─── Excel Index Domain ──────────────────────────────────────────────

const excelIndex = new ExcelIndexFunctions(scope, 'ExcelIndexFunctions', {
  pythonCommonLayer,
  contractIndexBucket: props.contractIndexBucket,
  excelIndexDataTable: props.excelIndexDataTable,
  indexRegistryTable: props.indexRegistryTable,
  models,
});
const excelIndexQueryFunction = excelIndex.excelIndexQueryFunction;
this.excelIndexParserFunction = excelIndex.excelIndexParserFunction;
this.excelIndexQueryFunction = excelIndex.excelIndexQueryFunction;
this.excelIndexApiFunction = excelIndex.excelIndexApiFunction;

websocketAPIFunction.addEnvironment('EXCEL_INDEX_QUERY_FUNCTION', excelIndexQueryFunction.functionName);
websocketAPIFunction.addEnvironment('INDEX_REGISTRY_TABLE', props.indexRegistryTable.tableName);
websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['lambda:InvokeFunction'],
  resources: [excelIndexQueryFunction.functionArn],
}));
websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['dynamodb:Query'],
  resources: [props.indexRegistryTable.tableArn],
}));

// Generates pre-signed S3 URLs so the frontend can link directly to
// source documents. Short 10s timeout — just signs a URL, no I/O.
const sourcePresignFunction = new lambda.Function(scope, 'SourcePresignFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: NODE_RUNTIME,
  code: lambda.Code.fromAsset(path.join(__dirname, 'source-presign')),
  handler: 'index.handler',
  environment: {
    "BUCKET": props.knowledgeBucket.bucketName,
  },
  timeout: cdk.Duration.seconds(10),
});
sourcePresignFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['s3:GetObject'],
  resources: [props.knowledgeBucket.bucketArn + '/*'],
}));
this.sourcePresignFunction = sourcePresignFunction;

// Mints short-lived presigned Amazon Transcribe streaming WebSocket URLs for
// the chat input's dictation mic (the browser Web Speech API is blocked on
// some managed networks, so audio streams to Transcribe instead). 10s timeout — it only
// signs a URL. The browser opens a *WebSocket* stream, so the role needs
// transcribe:StartStreamTranscriptionWebSocket — the HTTP/2
// StartStreamTranscription action does NOT authorize the WebSocket endpoint.
// Neither action has resource-level ARNs, so the resource must be "*" (covered
// by the stack's Resource::* nag suppression).
const transcribePresignFunction = new lambda.Function(scope, 'TranscribePresignFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: NODE_RUNTIME,
  code: lambda.Code.fromAsset(path.join(__dirname, 'transcribe-presign')),
  handler: 'index.handler',
  environment: {
    "LANGUAGE_CODE": "en-US",
    "SAMPLE_RATE": "16000",
  },
  timeout: cdk.Duration.seconds(10),
});
transcribePresignFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'transcribe:StartStreamTranscription',
    'transcribe:StartStreamTranscriptionWebSocket',
  ],
  resources: ['*'],
}));
this.transcribePresignFunction = transcribePresignFunction;

// ─── User Administration ────────────────────────────────────────────

// Admin-only API for inviting users (AdminCreateUser with an emailed
// temporary password), granting/revoking the Admin group, enabling,
// disabling and deleting users. IAM is limited to this stack's user pool.
const userAdminFunction = new lambda.Function(scope, 'UserAdminFunction', {
  ...LAMBDA_DEFAULTS,
  runtime: PYTHON_RUNTIME,
  code: pythonCode(path.join(__dirname, 'user-admin')),
  handler: 'lambda_function.lambda_handler',
  layers: [pythonCommonLayer],
  environment: {
    USER_POOL_ID: props.userPool.userPoolId,
    ADMIN_GROUP_NAME,
  },
  timeout: cdk.Duration.seconds(15),
});
userAdminFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'cognito-idp:ListUsers',
    'cognito-idp:ListUsersInGroup',
    'cognito-idp:AdminGetUser',
    'cognito-idp:AdminCreateUser',
    'cognito-idp:AdminAddUserToGroup',
    'cognito-idp:AdminRemoveUserFromGroup',
    'cognito-idp:AdminDisableUser',
    'cognito-idp:AdminEnableUser',
    'cognito-idp:AdminDeleteUser',
    'cognito-idp:AdminListGroupsForUser',
  ],
  resources: [props.userPool.userPoolArn],
}));
this.userAdminFunction = userAdminFunction;

// ─── Sync Domain ────────────────────────────────────────────────────

const syncFunctions = new SyncFunctions(scope, 'SyncFunctions', {
  pythonCommonLayer,
  knowledgeBase: props.knowledgeBase,
  knowledgeBaseSource: props.knowledgeBaseSource,
  knowledgeBucket: props.knowledgeBucket,
  contractIndexBucket: props.contractIndexBucket,
  dataStagingBucket: props.dataStagingBucket,
  syncHistoryTable: props.syncHistoryTable,
  indexRegistryTable: props.indexRegistryTable,
  metadataHandlerFunction,
});
this.syncOrchestratorFunction = syncFunctions.syncOrchestratorFunction;
this.syncScheduleFunction = syncFunctions.syncScheduleFunction;
}
}
