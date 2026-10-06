import json
import boto3
import os
import logging
import time

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
lambda_client = boto3.client('lambda')


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


def lambda_handler(event, context):
    """Evaluate one chunk of test cases and write its partial result to S3.

    A question that fails (generation or RAGAS error) is recorded with its error
    and excluded from the metric totals, so one bad question doesn't drag every
    average toward zero. Infrastructure failures (unreadable chunk, unwritable
    partial result) raise, so the Map state fails and the pipeline's Catch marks
    the evaluation FAILED instead of silently continuing with missing data.
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
            time.sleep(3)
        try:
            if not test_case.get('question') or 'expectedResponse' not in test_case:
                raise ValueError("Test case is missing 'question' or 'expectedResponse'")
            logging.info(f"Starting test case {idx+1}/{len(test_cases)}")
            result = process_test_case(idx, test_case)
            for name in METRIC_NAMES:
                totals[name] += result[name]
            num_succeeded += 1
            detailed_results.append(result)
            logging.info(f"Completed test case {idx+1}/{len(test_cases)} successfully")
        except Exception as e:
            logging.exception(f"Error processing test case {idx+1}")
            num_failed += 1
            failed = {
                'question': str(test_case.get('question') or f"Question {idx+1}"),
                'expectedResponse': str(test_case.get('expectedResponse') or ''),
                'actualResponse': 'Error during evaluation',
                'failed': True,
                'error': str(e)[:MAX_ERROR_LENGTH],
            }
            failed.update({name: None for name in METRIC_NAMES})
            detailed_results.append(failed)

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


def process_test_case(idx, test_case):
    question = test_case['question']
    expected_response = test_case['expectedResponse']

    logging.info(f"Processing test case {idx+1}: {question[:50]}...")

    actual_response, answer_context = invoke_generate_response_lambda(lambda_client, question)
    if not actual_response:
        raise RuntimeError("generate-response returned no answer")

    # Formatted retrieval for the admin UI's "retrieved context" panel.
    retrieved_context, _ = invoke_generate_response_lambda(lambda_client, question, get_context_only=True)

    # Score faithfulness and the context metrics against the chunks the answer
    # was actually generated from (the model's own tool queries). Fall back to a
    # direct retrieval on the question only when the answer used no KB context.
    ragas_context = answer_context or retrieved_context

    logging.info(f"Evaluating response for test case {idx+1}")

    max_retries = 3
    result = None

    for retry in range(max_retries):
        try:
            result = evaluate_with_ragas(question, expected_response, actual_response, ragas_context)
            break
        except Exception as e:
            retry_delay = 5 * (2 ** retry)
            if retry < max_retries - 1:
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
        'retrieved_context': retrieved_context or ragas_context,
    }


def _usable_context(value):
    text = value if isinstance(value, str) else ""
    text = text.strip()
    if not text or text.startswith(_NO_CONTEXT_PREFIX):
        return ""
    return text


def invoke_generate_response_lambda(lambda_client, question, get_context_only=False):
    """Return (text, context). text is the answer, or the formatted retrieval when
    get_context_only; context is the KB text the answer was generated from."""
    try:
        logging.info(f"Invoking generate-response Lambda for question: {question[:50]}...")

        payload = {'userMessage': question, 'chatHistory': []}
        if get_context_only:
            payload['get_context_only'] = True

        response = lambda_client.invoke(
            FunctionName=GENERATE_RESPONSE_LAMBDA_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps(payload),
        )

        logging.info("Response received from Lambda")
        payload_bytes = response['Payload'].read().decode('utf-8')
        result = json.loads(payload_bytes)

        if result.get('statusCode', 200) != 200:
            logging.error(f"Error response from Lambda: {result}")
            return "", ""

        body = json.loads(result.get('body', '{}'))

        if get_context_only:
            context = _usable_context(body.get('context', ''))
            logging.info(f"Received context of length: {len(context)} characters")
            return context, context

        response_text = body.get('modelResponse', '') or ''
        sources = body.get('sources') or {}
        answer_context = _usable_context(sources.get('content') if isinstance(sources, dict) else "")
        logging.info(f"Received response of length: {len(response_text)} characters")
        return response_text, answer_context
    except Exception as e:
        logging.error(f"Error invoking generateResponseLambda: {str(e)}")
        return "", ""


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
