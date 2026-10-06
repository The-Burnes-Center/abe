import boto3
import os
import json
import logging
from datetime import datetime
from botocore.exceptions import ClientError

# Environment variables
TEST_CASES_BUCKET = os.environ['TEST_CASES_BUCKET']
EVAL_RESULTS_BUCKET = os.environ.get('EVAL_RESULTS_BUCKET', TEST_CASES_BUCKET)

# Initialize clients
s3_client = boto3.client('s3')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# The six RAGAS metrics the eval Lambda computes. "relevance" was dropped: it was
# the same answer_relevancy score as response_relevancy, reported twice.
METRIC_NAMES = (
    'similarity',
    'correctness',
    'context_precision',
    'context_recall',
    'response_relevancy',
    'faithfulness',
)


class AggregationError(Exception):
    """Raised so Step Functions routes the run to its failure branch."""


def lambda_handler(event, context):
    """
    Aggregate partial evaluation results from the eval Lambda (Docker/RAGAS).

    Reads the partial results the eval Lambda wrote to S3, averages each metric
    over the questions that were scored successfully (failed questions are
    counted in failed_questions, not averaged in as zeros), writes the combined
    detailed results to S3, and returns the summary metrics.

    Raises when nothing could be scored or the results can't be written, so the
    state machine's Catch marks the evaluation FAILED.
    """
    logger.info(f"Lambda invoked with event: {json.dumps(event)}")

    evaluation_id = event.get('evaluation_id')
    if not evaluation_id:
        raise AggregationError("Missing required evaluation_id parameter")

    evaluation_name = event.get('evaluation_name', f"Evaluation on {str(datetime.now())}")
    test_cases_key = event.get('test_cases_key')
    partial_result_keys = []

    # Handle different partial results formats from Step Functions Map state
    for pr in event.get('partial_result_keys', []) or []:
        if isinstance(pr, dict) and pr.get('partial_result_key'):
            partial_result_keys.append(pr['partial_result_key'])
        elif isinstance(pr, str):
            partial_result_keys.append(pr)

    logger.info(f"Processing {len(partial_result_keys)} partial results for evaluation {evaluation_id}")
    if not partial_result_keys:
        raise AggregationError("No partial results were produced for this evaluation")

    totals = {name: 0.0 for name in METRIC_NAMES}
    total_questions = 0
    failed_questions = 0
    detailed_results = []
    errors = []

    for partial_result_key in partial_result_keys:
        try:
            partial_result = read_partial_result_from_s3(s3_client, TEST_CASES_BUCKET, partial_result_key)
        except Exception as e:
            logger.error(f"Error reading partial result {partial_result_key}: {e}")
            errors.append(partial_result_key)
            continue

        failed_questions += int(partial_result.get('num_failed', 0) or 0)
        detailed_results.extend(partial_result.get('detailed_results', []))
        num_cases = int(partial_result.get('num_test_cases', 0) or 0)
        if num_cases == 0:
            continue
        for name in METRIC_NAMES:
            totals[name] += float(partial_result.get(f'total_{name}', 0) or 0)
        total_questions += num_cases

    if total_questions == 0:
        raise AggregationError(
            f"No test cases were scored successfully ({failed_questions} failed, "
            f"{len(errors)} partial results unreadable)"
        )

    averages = {name: totals[name] / total_questions for name in METRIC_NAMES}
    for name, score in averages.items():
        if score < 0 or score > 1:
            logger.warning(f"Metric '{name}' is out of expected range [0,1]: {score:.4f}")

    detailed_results_s3_key = f'evaluations/{evaluation_id}/aggregated_results/detailed_results.json'
    s3_client.put_object(
        Bucket=EVAL_RESULTS_BUCKET,
        Key=detailed_results_s3_key,
        Body=json.dumps(detailed_results)
    )
    logger.info(f"Wrote aggregated results to S3: {EVAL_RESULTS_BUCKET}/{detailed_results_s3_key}")

    result = {
        'evaluation_id': evaluation_id,
        'evaluation_name': evaluation_name,
        'total_questions': total_questions,
        'failed_questions': failed_questions,
        'detailed_results_s3_key': detailed_results_s3_key,
        'test_cases_key': test_cases_key or '',
        **{f'average_{name}': round(averages[name], 4) for name in METRIC_NAMES},
        # Kept as null so a state machine that still maps $.average_relevance
        # doesn't fail on a missing path; results-to-ddb skips null metrics.
        'average_relevance': None,
    }
    if errors:
        result['unreadable_partial_results'] = len(errors)

    logger.info(f"Aggregation complete for evaluation {evaluation_id}. Results: {json.dumps(result)}")
    return result


def read_partial_result_from_s3(s3_client, bucket_name, key):
    """Read and parse a partial result JSON file from S3."""
    try:
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except ClientError as e:
        error_code = e.response['Error']['Code']
        raise Exception(f"Failed to read partial result from S3: {error_code}. Key: {key}")
    except json.JSONDecodeError as e:
        raise Exception(f"Failed to decode JSON from S3 object. Key: {key}. Error: {str(e)}")
