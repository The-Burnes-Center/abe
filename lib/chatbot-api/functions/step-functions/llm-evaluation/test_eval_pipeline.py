"""Tests for the eval pipeline's Python Lambdas: eval (RAGAS stubbed),
aggregate-eval-results and results-to-ddb."""
import importlib.util
import json
import os
import sys
import types
from unittest.mock import MagicMock

import boto3
import pytest
from moto import mock_aws

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "eval-bucket"
METRICS = ("similarity", "correctness", "context_precision", "context_recall", "response_relevancy", "faithfulness")


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("TEST_CASES_BUCKET", BUCKET)
    monkeypatch.setenv("EVAL_RESULTS_BUCKET", BUCKET)
    monkeypatch.setenv("GENERATE_RESPONSE_LAMBDA_NAME", "gen")
    monkeypatch.setenv("BEDROCK_MODEL_ID", "model")
    monkeypatch.setenv("EVAL_SUMMARIES_TABLE", "summaries")
    monkeypatch.setenv("EVAL_RESULTS_TABLE", "results")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, rel, "lambda_function.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


def _put_json(s3, key, value):
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(value))


def _get_json(s3, key):
    return json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())


# ---------------------------------------------------------------------------
# eval Lambda
# ---------------------------------------------------------------------------


@pytest.fixture()
def eval_lf(s3, monkeypatch):
    for mod_name in ("langchain_aws", "ragas", "ragas.llms", "ragas.embeddings"):
        stub = types.ModuleType(mod_name)
        stub.ChatBedrockConverse = stub.BedrockEmbeddings = MagicMock()
        stub.LangchainLLMWrapper = stub.LangchainEmbeddingsWrapper = MagicMock()
        monkeypatch.setitem(sys.modules, mod_name, stub)
    mod = _load("eval_lf", "eval")
    mod.s3_client = s3
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)
    return mod


def _scores(value):
    return {"status": "success", "scores": {name: value for name in METRICS}}


def test_eval_excludes_failed_questions_from_totals(eval_lf, s3, monkeypatch):
    _put_json(s3, "chunks/c1.json", [
        {"question": "good", "expectedResponse": "x"},
        {"question": "bad", "expectedResponse": "y"},
    ])

    def fake_invoke(_client, question, get_context_only=False):
        if question == "bad" and not get_context_only:
            return "", ""
        return ("formatted ctx", "formatted ctx") if get_context_only else ("answer", "answer ctx")

    seen_contexts = []

    def fake_ragas(question, expected, actual, context):
        seen_contexts.append(context)
        return _scores(0.8)

    monkeypatch.setattr(eval_lf, "invoke_generate_response_lambda", fake_invoke)
    monkeypatch.setattr(eval_lf, "evaluate_with_ragas", fake_ragas)

    out = eval_lf.lambda_handler({"chunk_key": "chunks/c1.json", "evaluation_id": "e1"}, None)

    assert out["num_test_cases"] == 1
    assert out["num_failed"] == 1
    partial = _get_json(s3, out["partial_result_key"])
    assert partial["total_correctness"] == pytest.approx(0.8)
    assert "total_relevance" not in partial
    failed = [r for r in partial["detailed_results"] if r.get("failed")]
    assert len(failed) == 1 and failed[0]["correctness"] is None
    # Faithfulness/context metrics are scored against the answer's own context.
    assert seen_contexts == ["answer ctx"]


def test_eval_raises_when_chunk_unreadable(eval_lf):
    with pytest.raises(Exception):
        eval_lf.lambda_handler({"chunk_key": "missing.json", "evaluation_id": "e1"}, None)


def test_usable_context_drops_no_knowledge_placeholder(eval_lf):
    assert eval_lf._usable_context("No knowledge available! blah") == ""
    assert eval_lf._usable_context(None) == ""
    assert eval_lf._usable_context(" real text ") == "real text"


# ---------------------------------------------------------------------------
# aggregate-eval-results
# ---------------------------------------------------------------------------


@pytest.fixture()
def agg_lf(s3):
    mod = _load("agg_lf", "aggregate-eval-results")
    mod.s3_client = s3
    return mod


def _partial(num, failed, value):
    return {
        "detailed_results": [{"question": "q"}] * (num + failed),
        "num_test_cases": num,
        "num_failed": failed,
        **{f"total_{m}": value * num for m in METRICS},
    }


def test_aggregate_averages_only_scored_questions(agg_lf, s3):
    _put_json(s3, "p1", _partial(2, 1, 0.9))
    _put_json(s3, "p2", _partial(0, 1, 0.0))
    out = agg_lf.lambda_handler({
        "evaluation_id": "e1",
        "evaluation_name": "n",
        "test_cases_key": "t.csv",
        "partial_result_keys": [{"partial_result_key": "p1"}, {"partial_result_key": "p2"}],
    }, None)
    assert out["total_questions"] == 2
    assert out["failed_questions"] == 2
    assert out["average_correctness"] == pytest.approx(0.9)
    assert out["average_relevance"] is None
    assert len(_get_json(s3, out["detailed_results_s3_key"])) == 4


def test_aggregate_raises_when_nothing_scored(agg_lf, s3):
    _put_json(s3, "p1", _partial(0, 3, 0.0))
    with pytest.raises(agg_lf.AggregationError):
        agg_lf.lambda_handler({"evaluation_id": "e1", "partial_result_keys": ["p1"]}, None)


def test_aggregate_raises_without_partials(agg_lf):
    with pytest.raises(agg_lf.AggregationError):
        agg_lf.lambda_handler({"evaluation_id": "e1", "partial_result_keys": []}, None)


# ---------------------------------------------------------------------------
# results-to-ddb
# ---------------------------------------------------------------------------


@pytest.fixture()
def ddb_lf(s3):
    ddb = boto3.resource("dynamodb", region_name="us-east-1")
    ddb.create_table(
        TableName="summaries",
        KeySchema=[{"AttributeName": "PartitionKey", "KeyType": "HASH"}, {"AttributeName": "Timestamp", "KeyType": "RANGE"}],
        AttributeDefinitions=[{"AttributeName": "PartitionKey", "AttributeType": "S"}, {"AttributeName": "Timestamp", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    ddb.create_table(
        TableName="results",
        KeySchema=[{"AttributeName": "EvaluationId", "KeyType": "HASH"}, {"AttributeName": "QuestionId", "KeyType": "RANGE"}],
        AttributeDefinitions=[{"AttributeName": "EvaluationId", "AttributeType": "S"}, {"AttributeName": "QuestionId", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    return _load("ddb_lf", "results-to-ddb")


def test_save_writes_summary_and_failed_rows(ddb_lf, s3):
    ddb_lf.summaries_table.put_item(Item={
        "PartitionKey": "Evaluation", "Timestamp": "2026-01-01", "EvaluationId": "e1",
        "executionArn": "arn", "status": "RUNNING",
    })
    _put_json(s3, "agg.json", [
        {"question": "q1", "expectedResponse": "a", "actualResponse": "b", **{m: 0.5 for m in METRICS}},
        {"question": "q2", "expectedResponse": "a", "actualResponse": "Error", "failed": True, "error": "boom",
         **{m: None for m in METRICS}},
    ])
    ddb_lf.lambda_handler({
        "evaluation_id": "e1", "evaluation_name": "n", "detailed_results_s3_key": "agg.json",
        "test_cases_key": "t.csv", "total_questions": 1, "failed_questions": 1,
        "average_relevance": None, **{f"average_{m}": 0.5 for m in METRICS},
    }, None)
    summary = ddb_lf.summaries_table.get_item(Key={"PartitionKey": "Evaluation", "Timestamp": "2026-01-01"})["Item"]
    assert summary["status"] == "COMPLETED"
    assert summary["failed_questions"] == 1
    assert "average_relevance" not in summary
    failed_row = ddb_lf.results_table.get_item(Key={"EvaluationId": "e1", "QuestionId": "1"})["Item"]
    assert failed_row["failed"] is True and "correctness" not in failed_row


def test_save_raises_on_missing_fields(ddb_lf):
    with pytest.raises(ValueError):
        ddb_lf.lambda_handler({"evaluation_id": "e1"}, None)


def test_mark_failed_creates_row_when_no_placeholder(ddb_lf):
    ddb_lf.lambda_handler({"evaluation_id": "e9", "mark_failed": True, "error_message": "x" * 3000}, None)
    rows = ddb_lf.summaries_table.scan()["Items"]
    assert rows[0]["status"] == "FAILED"
    assert len(rows[0]["error_message"]) < 2100
