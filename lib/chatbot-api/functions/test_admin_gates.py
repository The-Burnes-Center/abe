"""Every admin-only Python handler must reject non-admins with 403 (never 500)
and accept members of the Cognito Admin group, whatever claim encoding the
HTTP API JWT authorizer used. AWS clients are mocked out entirely."""
import importlib.util
import json
import os
import sys
from unittest.mock import patch

import pytest

FUNCTIONS_DIR = os.path.dirname(os.path.abspath(__file__))
LAYER_DIR = os.path.join(FUNCTIONS_DIR, "layers", "python-common", "python")
if LAYER_DIR not in sys.path:
    sys.path.insert(0, LAYER_DIR)

ENV = {
    "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_REGION": "us-east-1",
    "FEEDBACK_RECORDS_TABLE": "t", "RESPONSE_TRACE_TABLE": "t", "PROMPT_REGISTRY_TABLE": "t",
    "MONITORING_CASES_TABLE": "t", "DDB_TABLE_NAME": "t", "ANALYTICS_TABLE_NAME": "t",
    "EVALUATION_SUMMARIES_TABLE": "t", "EVALUATION_RESULTS_TABLE": "t", "TEST_LIBRARY_TABLE": "t",
    "BUCKET": "b", "KB_ID": "kb", "SOURCE": "ds", "SCHEDULE_NAME": "s", "SCHEDULE_GROUP": "g",
    "STAGING_BUCKET": "b", "INDEX_REGISTRY_TABLE": "t", "SYNC_HISTORY_TABLE": "t",
    "ORCHESTRATOR_LAMBDA_ARN": "arn", "USER_POOL_ID": "us-east-1_x",
}

# (handler dir, event) for one admin route per handler.
CASES = {
    "feedback-handler": {"rawPath": "/admin/feedback", "requestContext": {"http": {"method": "GET"}}},
    "metrics-handler": {"routeKey": "GET /metrics", "requestContext": {}},
    "llm-eval/eval-results-handler": {"body": json.dumps({"operation": "get_evaluation_summaries"}), "requestContext": {}},
    "llm-eval/test-library-handler": {"body": json.dumps({"operation": "stats"}), "requestContext": {}},
    "knowledge-management/delete-s3": {"body": json.dumps({"KEY": "doc.pdf"}), "requestContext": {}},
    "knowledge-management/kb-sync": {"rawPath": "/kb-sync/still-syncing", "requestContext": {}},
    "sync-schedule": {"rawPath": "/sync-history", "requestContext": {"http": {"method": "GET"}}},
    "user-admin": {"rawPath": "/admin/users", "requestContext": {"http": {"method": "GET"}}},
}


class _Unavailable:
    """Stand-in for every boto3 client/resource: building tables works, any
    real AWS call raises, so handlers stop right after the gate."""

    def __getattr__(self, name):
        if name == "Table":
            return lambda *a, **k: _Unavailable()

        def fail(*args, **kwargs):
            raise RuntimeError("AWS is not available in this test")
        return fail


def _load(handler_dir):
    for name in list(sys.modules):
        if name.startswith("common_utils"):
            sys.modules.pop(name)
    path = os.path.join(FUNCTIONS_DIR, handler_dir, "lambda_function.py")
    spec = importlib.util.spec_from_file_location(f"gate_{handler_dir.replace('/', '_')}", path)
    mod = importlib.util.module_from_spec(spec)
    with patch("boto3.client", return_value=_Unavailable()), patch("boto3.resource", return_value=_Unavailable()):
        spec.loader.exec_module(mod)
    return mod


def _with_groups(event, groups):
    event = json.loads(json.dumps(event))
    claims = {"cognito:username": "u1", "sub": "u1", "email": "u1@example.org"}
    if groups is not None:
        claims["cognito:groups"] = groups
    event["requestContext"]["authorizer"] = {"jwt": {"claims": claims}}
    return event


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)


@pytest.mark.parametrize("handler_dir", sorted(CASES))
@pytest.mark.parametrize("groups", [None, "[Viewers]", '["AdminViewer"]', "NotAdmin", ["admin"]])
def test_non_admin_gets_403(handler_dir, groups):
    mod = _load(handler_dir)
    resp = mod.lambda_handler(_with_groups(CASES[handler_dir], groups), None)
    assert resp["statusCode"] == 403


@pytest.mark.parametrize("handler_dir", sorted(CASES))
@pytest.mark.parametrize("groups", [["Admin"], '["Admin","Viewers"]', "[Viewers Admin]", "Admin"])
def test_admin_passes_gate(handler_dir, groups):
    mod = _load(handler_dir)
    try:
        resp = mod.lambda_handler(_with_groups(CASES[handler_dir], groups), None)
    except RuntimeError as e:
        # Reached an AWS call, so the gate let the admin through.
        assert "not available" in str(e)
        return
    assert resp["statusCode"] != 403
