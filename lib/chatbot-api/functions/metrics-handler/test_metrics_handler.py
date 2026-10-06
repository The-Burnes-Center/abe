"""Tests for the metrics-handler Lambda (moto-backed DynamoDB)."""
import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import boto3
import pytest
from moto import mock_aws

HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
LAYER_DIR = os.path.abspath(os.path.join(HANDLER_DIR, "..", "layers", "python-common", "python"))
if LAYER_DIR not in sys.path:
    sys.path.insert(0, LAYER_DIR)

SESSIONS = "test-sessions"
ANALYTICS = "test-analytics"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("DDB_TABLE_NAME", SESSIONS)
    monkeypatch.setenv("ANALYTICS_TABLE_NAME", ANALYTICS)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("BRAND_TIMEZONE", "UTC")


def _create_tables(ddb):
    ddb.create_table(
        TableName=SESSIONS,
        KeySchema=[{"AttributeName": "user_id", "KeyType": "HASH"}, {"AttributeName": "session_id", "KeyType": "RANGE"}],
        AttributeDefinitions=[{"AttributeName": "user_id", "AttributeType": "S"}, {"AttributeName": "session_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    ddb.create_table(
        TableName=ANALYTICS,
        KeySchema=[{"AttributeName": "topic", "KeyType": "HASH"}, {"AttributeName": "timestamp", "KeyType": "RANGE"}],
        AttributeDefinitions=[
            {"AttributeName": "topic", "AttributeType": "S"},
            {"AttributeName": "timestamp", "AttributeType": "S"},
            {"AttributeName": "date_key", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[{
            "IndexName": "DateIndex",
            "KeySchema": [{"AttributeName": "date_key", "KeyType": "HASH"}, {"AttributeName": "timestamp", "KeyType": "RANGE"}],
            "Projection": {"ProjectionType": "ALL"},
        }],
        BillingMode="PAY_PER_REQUEST",
    )


@pytest.fixture()
def lf():
    with mock_aws():
        _create_tables(boto3.resource("dynamodb", region_name="us-east-1"))
        for name in list(sys.modules):
            if name.startswith("common_utils"):
                sys.modules.pop(name)
        spec = importlib.util.spec_from_file_location("metrics_lf", os.path.join(HANDLER_DIR, "lambda_function.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        yield mod


def _event(params=None, groups='["Admin"]'):
    return {
        "routeKey": "GET /metrics",
        "queryStringParameters": params or {},
        "requestContext": {"authorizer": {"jwt": {"claims": {"cognito:groups": groups}}}},
    }


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_non_admin_gets_403(lf):
    resp = lf.lambda_handler(_event(groups="[Viewers]"), None)
    assert resp["statusCode"] == 403


def test_overview_uses_message_count_and_legacy_history(lf):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    lf.session_table.put_item(Item={
        "user_id": "u1", "session_id": "s1", "time_stamp": _iso(now),
        "message_count": 5, "chat_history": [{"user": "q"}],
    })
    # Legacy session without message_count: counted from its chat_history.
    lf.session_table.put_item(Item={
        "user_id": "u2", "session_id": "s2", "time_stamp": _iso(now),
        "chat_history": [{"user": "a"}, {"user": "b"}],
    })
    # Outside the default 30-day window.
    lf.session_table.put_item(Item={
        "user_id": "u3", "session_id": "s3", "time_stamp": _iso(now - timedelta(days=90)),
        "message_count": 9,
    })
    lf.analytics_table.put_item(Item={
        "topic": "General", "timestamp": _iso(now), "date_key": now.strftime("%Y-%m-%d"),
        "user_id": "u1", "display_name": "Ada", "question": "hi",
    })

    resp = lf.lambda_handler(_event(), None)
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 200
    assert body["total_sessions"] == 2
    assert body["total_messages"] == 7
    assert body["unique_users"] == 2
    assert body["timezone"] == "UTC"
    users = {u["user_id"]: u for u in body["daily_breakdown"][0]["users"]}
    assert users["u1"]["display_name"] == "Ada"
    assert "agency" not in users["u1"]


def test_by_user_has_no_agency_field(lf):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    lf.analytics_table.put_item(Item={
        "topic": "General", "timestamp": _iso(now), "date_key": now.strftime("%Y-%m-%d"),
        "user_id": "u1", "display_name": "Ada", "question": "hi",
    })
    body = json.loads(lf.lambda_handler(_event({"type": "by_user"}), None)["body"])
    assert body["users"][0]["display_name"] == "Ada"
    assert "agency" not in body["users"][0]
