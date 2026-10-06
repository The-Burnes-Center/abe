import json
import boto3
import os
import logging
import time
from botocore.config import Config

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

from langchain_aws import ChatBedrockConverse, BedrockEmbeddings
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper

GENERATE_RESPONSE_LAMBDA_NAME = os.environ['GENERATE_RESPONSE_LAMBDA_NAME']
BEDROCK_MODEL_ID = os.environ['BEDROCK_MODEL_ID']
TEST_CASES_BUCKET = os.environ['TEST_CASES_BUCKET']
EVAL_RESULTS_BUCKET = os.environ.get('EVAL_RESULTS_BUCKET', TEST_CASES_BUCKET)

s3_client = boto3.client('s3')

METRIC_NAMES = (
    'similarity',
    'correctness',
    'context_precision',
    'context_recall',
    'response_relevancy',
    'faithfulness',
)
MAX_ERROR_LENGTH = 500

# Text generate-response substitutes when retrieval finds nothing; it is not context.
_NO_CONTEXT_PREFIX = "No knowledge available!"

# Time budget inside this Lambda's own 15-minute cap. generate-response can
# take minutes, so each call's read timeout is derived from the time left,
# keeping room to score the answer and write the partial result. When too
# little time remains, the rest of the chunk is recorded as failed instead of
# being cut off by the Lambda timeout (which would lose the whole chunk).
WRITE_RESERVE_MS = 30_000        # S3 write + margin
SCORING_RESERVE_MS = 120_000     # RAGAS scoring of one answer
MIN_GENERATION_MS = 30_000       # don't start a generation with less than this
MAX_READ_TIMEOUT_SECONDS = 890   # below the 900s Lambda cap
BETWEEN_QUESTIONS_SECONDS = 3
OUT_OF_TIME_ERROR = "Not evaluated: the evaluation ran out of time for this chunk."


def _remaining_ms(context):
    if context is None or not hasattr(context, "get_remaining_time_in_millis"):
        return 15 * 60 * 1000
    return context.get_remaining_time_in_millis()


def _generation_budget_seconds(context):
    """Seconds generate-response may take for the next question, or 0 if there
    isn't enough time left to generate and score an answer."""
    budget_ms = _remaining_ms(context) - WRITE_RESERVE_MS - SCORING_RESERVE_MS
    if budget_ms < MIN_GENERATION_MS:
        return 0
    return min(budget_ms // 1000, MAX_READ_TIMEOUT_SECONDS)


def _lambda_client(read_timeout_seconds):
    # Never retry: a retried invoke would start a second generation.
    return boto3.client('lambda', config=Config(
        read_timeout=read_timeout_seconds,
        connect_timeout=10,
        retries={'total_max_attempts': 1},
    ))


def _failed_result(idx, test_case, error):
    failed = {
        'question': str(test_case.get('question') or f"Question {idx+1}"),
        'expectedResponse': str(test_case.get('expectedResponse') or ''),
        'actualResponse': 'Error during evaluation',
        'failed': True,
        'error': str(error)[:MAX_ERROR_LENGTH],
    }
    failed.update({name: None for name in METRIC_NAMES})
    return failed


def lambda_handler(event, context):
    """Evaluate one chunk of test cases and write its partial result to S3.

    A question that fails (generation or RAGAS error, or no time left) is
    recorded with its error and excluded from the metric totals, so one bad
    question doesn't drag every average toward zero. Infrastructure failures
    (unreadable chunk, unwritable partial result) raise, so the Map state fails
    and the pipeline's Catch marks the evaluation FAILED instead of silently
    continuing with missing data.
    """
    chunk_key = event["chunk_key"]
    evaluation_id = event["evaluation_id"]
    logging.info(f"Processing chunk: {chunk_key} for evaluation: {evaluation_id}")
    test_cases = read_chunk_from_s3(s3_client, TEST_CASES_BUCKET, chunk_key)
    logging.info(f"Retrieved {len(test_cases)} test cases to evaluate")

    detailed_results = []
    totals = {name: 0.0 for name in METRIC_NAMES}
    num_succeeded = 0
    num_failed = 0

    for idx, test_case in enumerate(test_cases):
        if idx > 0:
            time.sleep(BETWEEN_QUESTIONS_SECONDS)
        budget_seconds = _generation_budget_seconds(context)
        if budget_seconds == 0:
            remaining = test_cases[idx:]
            logging.warning(f"Out of time: recording {len(remaining)} remaining test case(s) as failed")
            for offset, skipped in enumerate(remaining):
                detailed_results.append(_failed_result(idx + offset, skipped, OUT_OF_TIME_ERROR))
            num_failed += len(remaining)
            break
        try:
            if not test_case.get('question') or 'expectedResponse' not in test_case:
                raise ValueError("Test case is missing 'question' or 'expectedResponse'")
            logging.info(f"Starting test case {idx+1}/{len(test_cases)} (generation budget {budget_seconds}s)")
            result = process_test_case(idx, test_case, context, budget_seconds)
            for name in METRIC_NAMES:
                totals[name] += result[name]
            num_succeeded += 1
            detailed_results.append(result)
            logging.info(f"Completed test case {idx+1}/{len(test_cases)} successfully")
        except Exception as e:
            logging.exception(f"Error processing test case {idx+1}")
            num_failed += 1
            detailed_results.append(_failed_result(idx, test_case, e))

    partial_results = {
        "detailed_results": detailed_results,
        "num_test_cases": num_succeeded,
        "num_failed": num_failed,
        **{f"total_{name}": totals[name] for name in METRIC_NAMES},
    }

    partial_result_key = f"evaluations/{evaluation_id}/partial_results/{os.path.basename(chunk_key)}"
    s3_client.put_object(
        Bucket=TEST_CASES_BUCKET,
        Key=partial_result_key,
        Body=json.dumps(partial_results)
    )
    logging.info(f"Wrote partial results to S3: {partial_result_key}")

    return {
        "partial_result_key": partial_result_key,
        "evaluation_id": evaluation_id,
        "num_test_cases": num_succeeded,
        "num_failed": num_failed,
    }


def process_test_case(idx, test_case, context=None, budget_seconds=MAX_READ_TIMEOUT_SECONDS):
    question = test_case['question']
    expected_response = test_case['expectedResponse']

    logging.info(f"Processing test case {idx+1}: {question[:50]}...")

    # One call: generate-response returns the answer together with the KB text
    # its own tool calls retrieved, so faithfulness and the context metrics are
    # scored against exactly what the answer was grounded on.
    actual_response, answer_context = invoke_generate_response_lambda(
        _lambda_client(budget_seconds), question
    )
    if not actual_response:
        raise RuntimeError("generate-response returned no answer")

    logging.info(f"Evaluating response for test case {idx+1}")

    max_retries = 3
    result = None

    for retry in range(max_retries):
        try:
            result = evaluate_with_ragas(question, expected_response, actual_response, answer_context)
            break
        except Exception as e:
            retry_delay = 5 * (2 ** retry)
            out_of_time = _remaining_ms(context) - retry_delay * 1000 < WRITE_RESERVE_MS + SCORING_RESERVE_MS // 2
            if retry < max_retries - 1 and not out_of_time:
                logging.warning(f"Retry {retry+1}/{max_retries} for RAGAS evaluation (waiting {retry_delay}s): {str(e)}")
                time.sleep(retry_delay)
            else:
                raise

    logging.info(f"RAGAS evaluation complete with scores: {result['scores']}")

    return {
        'question': question,
        'expectedResponse': expected_response,
        'actualResponse': actual_response,
        **{name: result['scores'][name] for name in METRIC_NAMES},
        'retrieved_context': answer_context,
    }


def _usable_context(value):
    text = value if isinstance(value, str) else ""
    text = text.strip()
    if not text or text.startswith(_NO_CONTEXT_PREFIX):
        return ""
    return text


def invoke_generate_response_lambda(lambda_client, question):
    """Return (answer, context): the model's answer and the KB text it was generated from.

    Raises on invoke errors, timeouts and non-200 responses so the failure
    reason is recorded on the question.
    """
    logging.info(f"Invoking generate-response Lambda for question: {question[:50]}...")
    payload = {'userMessage': question, 'chatHistory': []}
    response = lambda_client.invoke(
        FunctionName=GENERATE_RESPONSE_LAMBDA_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload),
    )
    result = json.loads(response['Payload'].read().decode('utf-8'))
    if response.get('FunctionError') or result.get('statusCode', 200) != 200:
        logging.error(f"Error response from generate-response: {str(result)[:1000]}")
        raise RuntimeError("generate-response returned an error")

    body = json.loads(result.get('body', '{}'))
    response_text = body.get('modelResponse', '') or ''
    answer_context = _usable_context(body.get('context'))
    if not answer_context:
        # Older generate-response builds only returned the context inside sources.
        sources = body.get('sources') or {}
        answer_context = _usable_context(sources.get('content') if isinstance(sources, dict) else "")
    logging.info(
        f"Received response of length {len(response_text)} with {len(answer_context)} chars of context"
    )
    return response_text, answer_context


def evaluate_with_ragas(question, expected_response, actual_response, retrieved_context):
    import pandas as pd
    from ragas import evaluate
    from ragas.metrics import (
        answer_correctness,
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )
    from ragas.metrics._answer_similarity import SemanticSimilarity
    from ragas import SingleTurnSample, EvaluationDataset
    from ragas.run_config import RunConfig

    semantic_similarity = SemanticSimilarity()
    metrics = [answer_correctness, semantic_similarity, answer_relevancy, context_precision, context_recall, faithfulness]
    region = os.environ.get("AWS_REGION")

    if not actual_response:
        actual_response = "No response"
    if not expected_response:
        expected_response = "No expected response provided"
    if not retrieved_context:
        retrieved_context = "No context retrieved"

    logging.info(f"RAGAS inputs - Question: {question[:50]}...")
    logging.info(f"RAGAS inputs - Answer length: {len(actual_response)}")
    logging.info(f"RAGAS inputs - Reference length: {len(expected_response)}")
    logging.info(f"RAGAS inputs - Context length: {len(retrieved_context)}")

    sample = SingleTurnSample(
        user_input=question,
        response=actual_response,
        reference=expected_response,
        retrieved_contexts=[retrieved_context],
    )
    dataset = EvaluationDataset(samples=[sample])

    evaluator_llm = LangchainLLMWrapper(ChatBedrockConverse(
        region_name=region,
        model=BEDROCK_MODEL_ID,
        temperature=0.0,
    ))
    evaluator_embeddings = LangchainEmbeddingsWrapper(BedrockEmbeddings(
        region_name=region,
        model_id='amazon.titan-embed-text-v2:0',
    ))

    run_config = RunConfig(timeout=120, max_retries=2, max_wait=30)

    logging.info("Starting RAGAS evaluation")
    result = evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=evaluator_llm,
        embeddings=evaluator_embeddings,
        run_config=run_config,
    )
    scores_df = result.to_pandas()
    logging.info(f"RAGAS result columns: {list(scores_df.columns)}")

    metric_cols = [c for c in scores_df.columns if c not in ('user_input', 'response', 'reference', 'retrieved_contexts')]
    row = scores_df.iloc[0]

    nan_cols = [c for c in metric_cols if pd.isna(row.get(c))]
    if nan_cols:
        logging.warning(f"RAGAS returned NaN for: {nan_cols} — defaulting to 0")

    def safe_score(col):
        val = row.get(col)
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return 0.0
        return float(val)

    logging.info("RAGAS evaluation completed successfully")
    return {
        "status": "success",
        "scores": {
            "similarity": safe_score('semantic_similarity'),
            "correctness": safe_score('answer_correctness'),
            "context_precision": safe_score('context_precision'),
            "context_recall": safe_score('context_recall'),
            "response_relevancy": safe_score('answer_relevancy'),
            "faithfulness": safe_score('faithfulness'),
        }
    }


def read_chunk_from_s3(s3_client, bucket_name, key):
    try:
        logging.info(f"Reading file from S3: {bucket_name}/{key}")
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        content = response['Body'].read().decode('utf-8')
        data = json.loads(content)
        logging.info(f"Successfully read file from S3, size: {len(content)} bytes")
        return data
    except Exception as e:
        logging.error(f"Error reading file from S3: {str(e)}")
        raise
