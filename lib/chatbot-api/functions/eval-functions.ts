/**
 * Evaluation pipeline Lambdas (created only when `enableEval` is true).
 *
 *   - GetS3TestCasesFilesHandlerFunction    — Lists/reads test case files
 *   - UploadS3TestCasesFilesHandlerFunction — Presigned uploads of test case files
 *   - EvalResultsHandlerFunction            — Reads/manages evaluation results + can stop runs
 *   - TestLibraryHandlerFunction            — CRUD for reusable test cases
 *   - FeedbackToTestLibraryProcessFunction  — SQS consumer: LLM-rewrites feedback into test cases
 *   - StepFunctionsStack                    — Orchestrates batch RAGAS evaluation
 *
 * Resources are created on `scope` (not `this`) so their CloudFormation
 * logical IDs match the ones they had when they lived in functions.ts.
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import { StepFunctionsStack } from './step-functions/step-functions';
import { anthropicInvokeResources, ModelIds } from '../../shared/bedrock';
import { ADMIN_GROUP_NAME, BRAND_PROMPT_ENV } from '../../constants';
import { LAMBDA_DEFAULTS, NODE_RUNTIME, PYTHON_RUNTIME, nodeCode, pythonCode } from '../../shared/lambda-defaults';

export interface EvalFunctionsProps {
  readonly pythonCommonLayer: lambda.ILayerVersion;
  readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  readonly promptRegistryTable: Table;
  readonly metadataRetrievalFunction: lambda.IFunction;
  readonly evalSummariesTable: Table;
  readonly evalResultsTable: Table;
  readonly testLibraryTable: Table;
  readonly evalTestCasesBucket: s3.Bucket;
  readonly evalResultsBucket: s3.Bucket;
  readonly feedbackToTestLibraryQueue: sqs.Queue;
  readonly models: ModelIds;
  /** Chat-tool dependencies: the eval generator runs the production agent loop. */
  readonly knowledgeBucket: s3.Bucket;
  readonly excelIndexQueryFunction: lambda.IFunction;
  readonly indexRegistryTable: Table;
}

export class EvalFunctions extends Construct {
  public readonly getS3TestCasesFunction: lambda.Function;
  public readonly uploadS3TestCasesFunction: lambda.Function;
  public readonly handleEvalResultsFunction: lambda.Function;
  public readonly testLibraryFunction: lambda.Function;
  public readonly feedbackToTestLibraryProcessFunction: lambda.Function;
  public readonly stepFunctionsStack: StepFunctionsStack;

  constructor(scope: Construct, id: string, props: EvalFunctionsProps) {
    super(scope, id);

    const getS3TestCasesFunction = new lambda.Function(scope, 'GetS3TestCasesFilesHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: NODE_RUNTIME,
      code: nodeCode(path.join(__dirname, 'llm-eval/S3-get-test-cases')),
      handler: 'index.handler',
      environment: {
        "ADMIN_GROUP_NAME": ADMIN_GROUP_NAME,
        "BUCKET": props.evalTestCasesBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    getS3TestCasesFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket', 's3:GetObject'],
      resources: [props.evalTestCasesBucket.bucketArn, props.evalTestCasesBucket.bucketArn + "/*"],
    }));
    this.getS3TestCasesFunction = getS3TestCasesFunction;

    const uploadS3TestCasesFunction = new lambda.Function(scope, 'UploadS3TestCasesFilesHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: NODE_RUNTIME,
      code: nodeCode(path.join(__dirname, 'llm-eval/S3-upload')),
      handler: 'index.handler',
      environment: {
        "ADMIN_GROUP_NAME": ADMIN_GROUP_NAME,
        "BUCKET": props.evalTestCasesBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    uploadS3TestCasesFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
      resources: [props.evalTestCasesBucket.bucketArn, props.evalTestCasesBucket.bucketArn + "/*"],
    }));
    this.uploadS3TestCasesFunction = uploadS3TestCasesFunction;

    // Eval results CRUD + ability to stop running evaluations.
    // 60s timeout: aggregation queries can scan large result sets.
    const evalResultsAPIHandlerFunction = new lambda.Function(scope, 'EvalResultsHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'llm-eval/eval-results-handler')),
      handler: 'lambda_function.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        "EVALUATION_RESULTS_TABLE": props.evalResultsTable.tableName,
        "EVALUATION_SUMMARIES_TABLE": props.evalSummariesTable.tableName,
        "TEST_CASES_BUCKET": props.evalTestCasesBucket.bucketName,
        "EVAL_RESULTS_BUCKET": props.evalResultsBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(60),
    });
    props.evalResultsTable.grantReadWriteData(evalResultsAPIHandlerFunction);
    props.evalSummariesTable.grantReadWriteData(evalResultsAPIHandlerFunction);
    this.handleEvalResultsFunction = evalResultsAPIHandlerFunction;

    // CRUD for the reusable test case library.
    const testLibraryFunction = new lambda.Function(scope, 'TestLibraryHandlerFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'llm-eval/test-library-handler')),
      handler: 'lambda_function.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        "TEST_LIBRARY_TABLE": props.testLibraryTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    testLibraryFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
      resources: [props.testLibraryTable.tableArn, props.testLibraryTable.tableArn + "/index/*"],
    }));
    this.testLibraryFunction = testLibraryFunction;

    // Feedback-to-test-library pipeline: the feedback handler enqueues admin-
    // promoted positive feedback (see promote_to_candidate); this consumer
    // rewrites the Q&A pair via LLM and inserts it into TestLibraryTable. 90s
    // timeout for LLM calls. Batch size 1 gives each item its own invocation.
    const feedbackToTestLibraryProcessFunction = new lambda.Function(scope, 'FeedbackToTestLibraryProcessFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'llm-eval/feedback-to-test-library')),
      handler: 'process.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        "TEST_LIBRARY_TABLE": props.testLibraryTable.tableName,
        "MODEL_ID": props.models.primary,
        "PRIMARY_MODEL_ID": props.models.primary,
        ...BRAND_PROMPT_ENV,
      },
      timeout: cdk.Duration.seconds(90),
      memorySize: 256,
    });
    feedbackToTestLibraryProcessFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [props.testLibraryTable.tableArn, props.testLibraryTable.tableArn + "/index/*"],
    }));
    feedbackToTestLibraryProcessFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: anthropicInvokeResources(),
    }));
    feedbackToTestLibraryProcessFunction.addEventSource(new SqsEventSource(props.feedbackToTestLibraryQueue, {
      batchSize: 1,
    }));
    this.feedbackToTestLibraryProcessFunction = feedbackToTestLibraryProcessFunction;

    this.stepFunctionsStack = new StepFunctionsStack(scope, 'StepFunctionsStack', {
      knowledgeBase: props.knowledgeBase,
      evalSummariesTable: props.evalSummariesTable,
      evalResutlsTable: props.evalResultsTable,
      evalTestCasesBucket: props.evalTestCasesBucket,
      evalResultsBucket: props.evalResultsBucket,
      promptRegistryTable: props.promptRegistryTable,
      metadataRetrievalFunction: props.metadataRetrievalFunction,
      models: props.models,
      knowledgeBucket: props.knowledgeBucket,
      excelIndexQueryFunction: props.excelIndexQueryFunction,
      indexRegistryTable: props.indexRegistryTable,
    });

    // The results handler polls run status and can stop a run: scope it to
    // executions of this stack's evaluation state machine.
    const evalExecutionArnPattern = cdk.Stack.of(scope).formatArn({
      service: 'states',
      resource: 'execution',
      resourceName: `${this.stepFunctionsStack.llmEvalStateMachine.stateMachineName}:*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    evalResultsAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['states:DescribeExecution', 'states:GetExecutionHistory', 'states:StopExecution'],
      resources: [evalExecutionArnPattern],
    }));
    NagSuppressions.addResourceSuppressions(evalResultsAPIHandlerFunction, [{
      id: 'AwsSolutions-IAM5',
      reason: 'Execution ARNs are generated per run; the wildcard is limited to executions of this stack\'s evaluation state machine.',
      appliesTo: [{ regex: '/^Resource::arn:.+:states:.+:execution:<.*EvaluationStateMachine.*\\.Name>:\\*$/' }],
    }], true);
    evalResultsAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [props.evalTestCasesBucket.bucketArn, props.evalResultsBucket.bucketArn],
      conditions: {
        StringLike: { 's3:prefix': ['evaluations/*'] },
      },
    }));
    evalResultsAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:DeleteObject'],
      resources: [
        `${props.evalTestCasesBucket.bucketArn}/evaluations/*`,
        `${props.evalResultsBucket.bucketArn}/evaluations/*`,
      ],
    }));
  }
}
