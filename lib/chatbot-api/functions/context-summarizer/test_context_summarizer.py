"""Tests for the context-summarizer Lambda's structured -> fallback path."""
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
LAYER_DIR = os.path.abspath(os.path.join(HANDLER_DIR, "..", "layers", "python-common", "python"))
if LAYER_DIR not in sys.path:
    sys.path.insert(0, LAYER_DIR)


@pytest.fixture()
def lf(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    spec = importlib.util.spec_from_file_location("ctx_summarizer_lf", os.path.join(HANDLER_DIR, "lambda_function.py"))
    mod = importlib.util.module_from_spec(spec)
    with patch("boto3.client"):
        spec.loader.exec_module(mod)
    return mod


def _model_reply(text):
    body = MagicMock()
    body.read.return_value = json.dumps({"content": [{"text": text}]}).encode()
    return {"body": body}


def _run(lf, *replies):
    lf.bedrock = MagicMock()
    lf.bedrock.invoke_model.side_effect = [_model_reply(r) for r in replies]
    resp = lf.lambda_handler({"conversation_text": "User: hi\nAssistant: hello"}, None)
    return resp, json.loads(resp["body"])


def test_structured_summary(lf):
    structured = json.dumps({
        "key_facts": ["a"], "questions_answered": ["q"], "data_retrieved": [], "active_topic": "t",
    })
    resp, body = _run(lf, structured)
    assert resp["statusCode"] == 200
    assert body["summary_data"]["active_topic"] == "t"
    assert "Current focus: t" in body["summary_text"]


def test_no_json_falls_back_to_plain_summary(lf):
    # extract_json_object raises ValueError here; this used to escape as a 500.
    resp, body = _run(lf, "Sorry, here is prose with no JSON.", "Plain summary.")
    assert resp["statusCode"] == 200
    assert body["summary_data"] is None
    assert body["summary_text"] == "Plain summary."


def test_schema_mismatch_falls_back(lf):
    resp, body = _run(lf, json.dumps({"key_facts": "not a list"}), "Plain summary.")
    assert resp["statusCode"] == 200
    assert body["summary_text"] == "Plain summary."


def test_fallback_failure_returns_generic_500(lf):
    lf.bedrock = MagicMock()
    lf.bedrock.invoke_model.side_effect = [_model_reply("no json"), RuntimeError("secret detail")]
    resp = lf.lambda_handler({"conversation_text": "x"}, None)
    assert resp["statusCode"] == 500
    assert "secret detail" not in resp["body"]


def test_missing_text_is_400(lf):
    assert lf.lambda_handler({}, None)["statusCode"] == 400
