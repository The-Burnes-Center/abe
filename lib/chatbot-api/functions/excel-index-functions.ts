/**
 * Excel index (structured tabular data) Lambdas.
 *
 *   - ExcelIndexParserFunction — S3 event-driven: parses .xlsx into DynamoDB
 *   - ExcelIndexQueryFunction  — DynamoDB query engine (filters, counts, sorts)
 *   - ExcelIndexApiFunction    — REST API for index management
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
import { S3EventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { anthropicInvokeResources, ModelIds } from '../../shared/bedrock';
import { LAMBDA_DEFAULTS, NODE_RUNTIME, PYTHON_RUNTIME, pythonBundledCode } from '../../shared/lambda-defaults';

export interface ExcelIndexFunctionsProps {
  readonly pythonCommonLayer: lambda.ILayerVersion;
  readonly contractIndexBucket: s3.Bucket;
  readonly excelIndexDataTable: Table;
  readonly indexRegistryTable: Table;
  readonly models: ModelIds;
}

export class ExcelIndexFunctions extends Construct {
  public readonly excelIndexParserFunction: lambda.Function;
  public readonly excelIndexQueryFunction: lambda.Function;
  public readonly excelIndexApiFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ExcelIndexFunctionsProps) {
    super(scope, id);

    // S3 event-driven parser: triggered on .xlsx upload/delete under indexes/.
    // Reads the spreadsheet, uses LLM to generate column descriptions, and
    // writes rows to DynamoDB. 2-min timeout + 512 MB for large spreadsheets.
    const excelIndexParserFunction = new lambda.Function(scope, 'ExcelIndexParserFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonBundledCode(path.join(__dirname, 'excel-index/parser')),
      handler: 'lambda_function.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        BUCKET: props.contractIndexBucket.bucketName,
        TABLE_NAME: props.excelIndexDataTable.tableName,
        INDEX_REGISTRY_TABLE: props.indexRegistryTable.tableName,
        PRIMARY_MODEL_ID: props.models.primary,
      },
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
    });
    excelIndexParserFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [props.contractIndexBucket.bucketArn + '/*'],
    }));
    excelIndexParserFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:BatchWriteItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
      resources: [props.excelIndexDataTable.tableArn],
    }));
    excelIndexParserFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:GetItem'],
      resources: [props.indexRegistryTable.tableArn],
    }));
    excelIndexParserFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: anthropicInvokeResources(),
    }));
    excelIndexParserFunction.addEventSource(new S3EventSource(props.contractIndexBucket, {
      events: [s3.EventType.OBJECT_CREATED, s3.EventType.OBJECT_REMOVED],
      filters: [{ prefix: 'indexes/', suffix: '.xlsx' }],
    }));
    this.excelIndexParserFunction = excelIndexParserFunction;

    // DynamoDB query engine invoked by the chat Lambda's query_excel_index tool.
    // Supports filters, counts, sorts, distinct values. 256 MB for large result sets.
    const excelIndexQueryFunction = new lambda.Function(scope, 'ExcelIndexQueryFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonBundledCode(path.join(__dirname, 'excel-index/query')),
      handler: 'lambda_function.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        TABLE_NAME: props.excelIndexDataTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    excelIndexQueryFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [props.excelIndexDataTable.tableArn],
    }));
    this.excelIndexQueryFunction = excelIndexQueryFunction;

    // REST API for admin index management: create, list, delete indexes.
    // Delegates actual queries to the query function via Lambda invoke.
    const excelIndexApiFunction = new lambda.Function(scope, 'ExcelIndexApiFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: NODE_RUNTIME,
      code: lambda.Code.fromAsset(path.join(__dirname, 'excel-index/api')),
      handler: 'index.handler',
      environment: {
        QUERY_FUNCTION: excelIndexQueryFunction.functionName,
        BUCKET: props.contractIndexBucket.bucketName,
        INDEX_REGISTRY_TABLE: props.indexRegistryTable.tableName,
        TABLE_NAME: props.excelIndexDataTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    excelIndexApiFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [excelIndexQueryFunction.functionArn],
    }));
    excelIndexApiFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [props.contractIndexBucket.bucketArn + '/*'],
    }));
    excelIndexApiFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
      resources: [props.indexRegistryTable.tableArn],
    }));
    excelIndexApiFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Scan', 'dynamodb:BatchWriteItem'],
      resources: [props.excelIndexDataTable.tableArn],
    }));
    this.excelIndexApiFunction = excelIndexApiFunction;
  }
}
