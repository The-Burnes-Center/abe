import os
import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError
import json
from datetime import datetime
from decimal import Decimal
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Retrieve DynamoDB table names from environment variables
EVALUATION_SUMMARIES_TABLE = os.environ.get("EVAL_SUMMARIES_TABLE")
EVALUATION_RESULTS_TABLE = os.environ.get("EVAL_RESULTS_TABLE")
TEST_CASES_BUCKET = os.environ["TEST_CASES_BUCKET"]
EVAL_RESULTS_BUCKET = os.environ.get("EVAL_RESULTS_BUCKET", TEST_CASES_BUCKET)  # Fallback to TEST_CASES_BUCKET if not set

dynamodb = boto3.resource("dynamodb")

summaries_table = dynamodb.Table(EVALUATION_SUMMARIES_TABLE)
results_table = dynamodb.Table(EVALUATION_RESULTS_TABLE)

# Summary metrics written by the save step. average_relevance is no longer
# produced (it duplicated response_relevancy) but older rows still carry it.
SUMMARY_METRICS = (
    'average_similarity',
    'average_correctness',
    'average_context_precision',
    'average_context_recall',
    'average_response_relevancy',
    'average_faithfulness',
)
RESULT_METRICS = (
    'similarity',
    'correctness',
    'context_precision',
    'context_recall',
    'response_relevancy',
    'faithfulness',
)
MAX_ERROR_LENGTH = 2000

HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
}


def _decimal(value):
    return Decimal(str(value))


def _find_existing_placeholder(evaluation_id):
    """Find the placeholder summary row created by start-llm-eval.

    The FilterExpression runs after each page is read, so keep paginating:
    a page with no match doesn't mean the row doesn't exist.
    """
    matches = []
    exclusive = None
    while True:
        qargs = {
            "KeyConditionExpression": Key("PartitionKey").eq("Evaluation"),
            "FilterExpression": Attr("EvaluationId").eq(evaluation_id),
            "ScanIndexForward": False,
        }
        if exclusive:
            qargs["ExclusiveStartKey"] = exclusive
        resp = summaries_table.query(**qargs)
        for item in resp.get("Items", []):
            if item.get("executionArn"):
                return item
            matches.append(item)
        exclusive = resp.get("LastEvaluatedKey")
        if not exclusive:
            return matches[0] if matches else None


def mark_evaluation_failed(evaluation_id, evaluation_name, error_message):
    """Flip an evaluation's summary row to FAILED.

    Invoked by the Step Functions error-handling branch when any step fails, so the
    run stops showing as RUNNING (with a perpetual progress bar) in the admin UI.
    Raises on failure so the execution history shows why the row wasn't updated.
    """
    error_message = error_message or "Evaluation failed"
    if len(error_message) > MAX_ERROR_LENGTH:
        error_message = error_message[:MAX_ERROR_LENGTH] + "...(truncated)"
    existing = _find_existing_placeholder(evaluation_id)
    if existing:
        update_expr_parts = ["#st = :failed", "error_message = :em"]
        expr_values = {":failed": "FAILED", ":em": error_message}
        if evaluation_name and evaluation_name.strip():
            update_expr_parts.append("evaluation_name = :en")
            expr_values[":en"] = evaluation_name.strip()
        summaries_table.update_item(
            Key={"PartitionKey": existing["PartitionKey"], "Timestamp": existing["Timestamp"]},
            UpdateExpression="SET " + ", ".join(update_expr_parts),
            ExpressionAttributeValues=expr_values,
            ExpressionAttributeNames={"#st": "status"},
        )
        logger.info(f"Marked evaluation {evaluation_id} as FAILED")
    else:
        # No placeholder found (e.g. split failed very early) -- create a minimal row.
        summaries_table.put_item(Item={
            "PartitionKey": "Evaluation",
            "Timestamp": str(datetime.now()),
            "EvaluationId": evaluation_id,
            "evaluation_name": (evaluation_name or "").strip() or "Unnamed",
            "status": "FAILED",
            "error_message": error_message,
        })
        logger.info(f"Created FAILED summary row for {evaluation_id}")
    return {
        "statusCode": 200,
        "headers": HEADERS,
        "body": json.dumps({"message": "Evaluation marked as failed", "evaluation_id": evaluation_id}),
        "evaluation_id": evaluation_id,
    }


def _result_item(evaluation_id, idx, result, test_cases_key):
    item = {
        'EvaluationId': evaluation_id,
        'QuestionId': str(idx),
        'question': result.get('question', ''),
        'expected_response': result.get('expectedResponse', ''),
        'actual_response': result.get('actualResponse', ''),
        'test_cases_key': test_cases_key,
    }
    for name in RESULT_METRICS:
        if result.get(name) is not None:
            item[name] = _decimal(result[name])
    if result.get('failed'):
        item['failed'] = True
        item['error'] = str(result.get('error', ''))[:MAX_ERROR_LENGTH]
    if result.get('retrieved_context'):
        item['retrieved_context'] = result['retrieved_context']
    return item


def add_evaluation(evaluation_id, evaluation_name, metrics, total_questions, failed_questions,
                   detailed_results, test_cases_key):
    """Write the summary row (updating the placeholder when present) and per-question rows."""
    present = {name: value for name, value in metrics.items() if value is not None}
    existing = _find_existing_placeholder(evaluation_id)

    if existing:
        update_expr_parts = ["total_questions = :tq", "failed_questions = :fq", "#st = :done"]
        expr_values = {":tq": total_questions, ":fq": failed_questions, ":done": "COMPLETED"}
        for i, (name, value) in enumerate(present.items()):
            update_expr_parts.append(f"{name} = :m{i}")
            expr_values[f":m{i}"] = _decimal(value)
        if evaluation_name and evaluation_name.strip():
            update_expr_parts.append("evaluation_name = :en")
            expr_values[":en"] = evaluation_name.strip()
        if test_cases_key:
            update_expr_parts.append("test_cases_key = :tk")
            expr_values[":tk"] = test_cases_key
        summaries_table.update_item(
            Key={"PartitionKey": existing["PartitionKey"], "Timestamp": existing["Timestamp"]},
            UpdateExpression="SET " + ", ".join(update_expr_parts),
            ExpressionAttributeValues=expr_values,
            ExpressionAttributeNames={"#st": "status"},
        )
        logger.info(f"Updated existing placeholder for {evaluation_id} at Timestamp={existing['Timestamp']}")
    else:
        summary_item = {
            'EvaluationId': evaluation_id,
            'Timestamp': str(datetime.now()),
            'total_questions': total_questions,
            'failed_questions': failed_questions,
            'evaluation_name': evaluation_name.strip() if evaluation_name else None,
            'test_cases_key': test_cases_key,
            'PartitionKey': "Evaluation",
            'status': 'COMPLETED',
            **{name: _decimal(value) for name, value in present.items()},
        }
        summaries_table.put_item(Item={k: v for k, v in summary_item.items() if v is not None})
        logger.info(f"Created new summary for {evaluation_id}")

    with results_table.batch_writer() as batch:
        for idx, result in enumerate(detailed_results):
            batch.put_item(Item=_result_item(evaluation_id, idx, result, test_cases_key))


def read_detailed_results_from_s3(detailed_results_s3_key):
    s3_client = boto3.client('s3')
    try:
        response = s3_client.get_object(Bucket=EVAL_RESULTS_BUCKET, Key=detailed_results_s3_key)
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchKey' or EVAL_RESULTS_BUCKET == TEST_CASES_BUCKET:
            raise
        # Older runs wrote aggregated results to the test cases bucket.
        response = s3_client.get_object(Bucket=TEST_CASES_BUCKET, Key=detailed_results_s3_key)
    return json.loads(response['Body'].read().decode('utf-8'))


def _parse_event(event):
    if isinstance(event, dict) and event.get('body'):
        return json.loads(event['body']) if isinstance(event['body'], str) else event['body']
    return event


def lambda_handler(event, context):
    """Save step of the evaluation state machine (and its failure branch).

    Errors raise instead of returning a 500-shaped dict: Step Functions treats a
    returned dict as success, which used to let a failed save end the run as
    SUCCEEDED with no results stored.
    """
    data = _parse_event(event)
    logger.info(f"Received data: {json.dumps(data, default=str)}")

    evaluation_id = data.get('evaluation_id')
    if not evaluation_id:
        raise ValueError("Missing evaluation_id")

    # Error-handling branch: the Step Functions failure path invokes this Lambda with
    # mark_failed=True to record the failure (status=FAILED).
    if data.get('mark_failed'):
        return mark_evaluation_failed(evaluation_id, data.get('evaluation_name'), data.get('error_message'))

    detailed_results_s3_key = data.get('detailed_results_s3_key')
    test_cases_key = data.get('test_cases_key')
    missing = [name for name, value in (
        ('detailed_results_s3_key', detailed_results_s3_key),
        ('test_cases_key', test_cases_key),
    ) if not value]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")

    evaluation_name = data.get('evaluation_name', f"Evaluation on {str(datetime.now())}")
    metrics = {name: data.get(name) for name in SUMMARY_METRICS}
    total_questions = int(data.get('total_questions', 0) or 0)
    failed_questions = int(data.get('failed_questions', 0) or 0)

    logger.info(f"Retrieving detailed results from S3: {detailed_results_s3_key}")
    detailed_results = read_detailed_results_from_s3(detailed_results_s3_key)

    logger.info(f"Saving evaluation {evaluation_id} with {len(detailed_results)} results to DynamoDB")
    add_evaluation(
        evaluation_id,
        evaluation_name,
        metrics,
        total_questions,
        failed_questions,
        detailed_results,
        test_cases_key,
    )
    logger.info(f"Successfully saved evaluation {evaluation_id} to DynamoDB")
    return {
        'statusCode': 200,
        'headers': HEADERS,
        'body': json.dumps({'message': 'Evaluation added successfully', 'evaluation_id': evaluation_id}),
        'evaluation_id': evaluation_id,
    }
