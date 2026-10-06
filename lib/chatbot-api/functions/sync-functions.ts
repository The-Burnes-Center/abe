/**
 * Automated data-sync pipeline.
 *
 *   - SyncOrchestratorFunction  — Moves staged files to KB/index buckets + triggers ingestion
 *   - WeeklySyncSchedule        — EventBridge Scheduler cron (Sundays 1:00 AM, brand timezone)
 *   - MetadataBackfillSchedule  — Hourly backfill of document summaries
 *   - SyncScheduleFunction      — Admin API for viewing/updating the weekly schedule + history
 *
 * Resources are created on `scope` (not `this`) so their CloudFormation
 * logical IDs match the ones they had when they lived in functions.ts.
 *
 * CloudFormation only rewrites a schedule when its template properties change,
 * so edits made from the admin UI (UpdateSchedule) survive ordinary deploys.
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { BRAND_TIMEZONE } from '../../constants';
import { boundedName } from '../../shared/names';
import { LAMBDA_DEFAULTS, PYTHON_RUNTIME, pythonCode } from '../../shared/lambda-defaults';

/** EventBridge Scheduler schedule and group names are limited to 64 characters. */
const SCHEDULER_NAME_MAX = 64;

export interface SyncFunctionsProps {
  readonly pythonCommonLayer: lambda.ILayerVersion;
  readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  readonly knowledgeBaseSource: bedrock.CfnDataSource;
  readonly knowledgeBucket: s3.Bucket;
  readonly contractIndexBucket: s3.Bucket;
  readonly dataStagingBucket: s3.Bucket;
  readonly syncHistoryTable: Table;
  readonly indexRegistryTable: Table;
  readonly metadataHandlerFunction: lambda.Function;
}

export class SyncFunctions extends Construct {
  public readonly syncOrchestratorFunction: lambda.Function;
  public readonly syncScheduleFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: SyncFunctionsProps) {
    super(scope, id);

    const stack = cdk.Stack.of(scope);

    // Orchestrator: reads from the staging bucket, copies files to the
    // appropriate destination (KB bucket or index bucket), triggers a
    // Bedrock KB ingestion job, and logs the run to SyncHistoryTable.
    // 5-min timeout + 256 MB: may copy many files and wait for ingestion.
    const syncOrchestratorFunction = new lambda.Function(scope, 'SyncOrchestratorFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'sync-orchestrator')),
      handler: 'lambda_function.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        STAGING_BUCKET: props.dataStagingBucket.bucketName,
        KB_BUCKET: props.knowledgeBucket.bucketName,
        INDEX_BUCKET: props.contractIndexBucket.bucketName,
        KB_ID: props.knowledgeBase.attrKnowledgeBaseId,
        KB_DATA_SOURCE_ID: props.knowledgeBaseSource.attrDataSourceId,
        SYNC_HISTORY_TABLE: props.syncHistoryTable.tableName,
        METADATA_HANDLER_FUNCTION: props.metadataHandlerFunction.functionName,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
    });
    syncOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket', 's3:GetObject', 's3:DeleteObject'],
      resources: [props.dataStagingBucket.bucketArn, props.dataStagingBucket.bucketArn + '/*'],
    }));
    syncOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [props.knowledgeBucket.bucketArn + '/*', props.contractIndexBucket.bucketArn + '/*'],
    }));
    // Read access on the KB bucket so the orchestrator can list objects and
    // inspect head metadata to decide which files still need a summary.
    syncOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket', 's3:GetObject'],
      resources: [props.knowledgeBucket.bucketArn, props.knowledgeBucket.bucketArn + '/*'],
    }));
    // Async-invoke the metadata handler so any KB file missing a summary gets
    // backfilled during every sync run.
    props.metadataHandlerFunction.grantInvoke(syncOrchestratorFunction);
    syncOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:StartIngestionJob', 'bedrock:ListIngestionJobs'],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn],
    }));
    syncOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [props.syncHistoryTable.tableArn],
    }));
    this.syncOrchestratorFunction = syncOrchestratorFunction;

    const schedulerRole = new iam.Role(scope, 'SyncSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [syncOrchestratorFunction.functionArn],
    }));

    const scheduleGroup = new scheduler.CfnScheduleGroup(scope, 'SyncScheduleGroup', {
      name: boundedName(stack.stackName, '-SyncScheduleGroup', SCHEDULER_NAME_MAX),
    });

    // Weekly in the brand timezone (same local time year-round, matching how
    // the admin UI displays sync history).
    const syncSchedule = new scheduler.CfnSchedule(scope, 'WeeklySyncSchedule', {
      name: boundedName(stack.stackName, '-WeeklySyncSchedule', SCHEDULER_NAME_MAX),
      groupName: scheduleGroup.name!,
      scheduleExpression: 'cron(0 1 ? * SUN *)',
      scheduleExpressionTimezone: BRAND_TIMEZONE,
      state: 'ENABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: syncOrchestratorFunction.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });
    syncSchedule.addDependency(scheduleGroup);

    // Hourly metadata backfill. KB ingestion completes minutes-to-hours after the
    // S3 upload events have already fired, so document summaries can't be
    // generated at upload time (no chunks exist in the KB yet). This schedule
    // re-invokes the orchestrator in backfill-only mode (no staging moves, no
    // ingestion job, no sync-history record) to summarize any document still
    // missing a real summary once its chunks have been ingested.
    const metadataBackfillSchedule = new scheduler.CfnSchedule(scope, 'MetadataBackfillSchedule', {
      name: boundedName(stack.stackName, '-MetadataBackfillSchedule', SCHEDULER_NAME_MAX),
      groupName: scheduleGroup.name!,
      scheduleExpression: 'rate(1 hour)',
      state: 'ENABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: syncOrchestratorFunction.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ backfillOnly: true }),
      },
    });
    metadataBackfillSchedule.addDependency(scheduleGroup);

    // Admin API for viewing/updating the sync schedule (enable, disable,
    // change cron expression) and viewing sync history.
    const syncScheduleFunction = new lambda.Function(scope, 'SyncScheduleFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'sync-schedule')),
      handler: 'lambda_function.lambda_handler',
      layers: [props.pythonCommonLayer],
      environment: {
        SCHEDULE_NAME: syncSchedule.name!,
        SCHEDULE_GROUP: scheduleGroup.name!,
        STAGING_BUCKET: props.dataStagingBucket.bucketName,
        INDEX_REGISTRY_TABLE: props.indexRegistryTable.tableName,
        SYNC_HISTORY_TABLE: props.syncHistoryTable.tableName,
        ORCHESTRATOR_LAMBDA_ARN: syncOrchestratorFunction.functionArn,
        BRAND_TIMEZONE,
      },
      timeout: cdk.Duration.seconds(30),
    });
    const scheduleArn = stack.formatArn({
      service: 'scheduler',
      resource: 'schedule',
      resourceName: `${scheduleGroup.name!}/${syncSchedule.name!}`,
    });
    syncScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['scheduler:GetSchedule', 'scheduler:UpdateSchedule'],
      resources: [scheduleArn],
    }));
    syncScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));
    syncScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:Scan'],
      resources: [props.syncHistoryTable.tableArn, props.indexRegistryTable.tableArn],
    }));
    syncScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [props.dataStagingBucket.bucketArn],
    }));
    syncScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [syncOrchestratorFunction.functionArn],
    }));
    this.syncScheduleFunction = syncScheduleFunction;
  }
}
