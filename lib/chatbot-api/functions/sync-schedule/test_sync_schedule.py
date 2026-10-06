"""Tests for sync-schedule's human-readable schedule text and input validation."""
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

ENV = {
    "SCHEDULE_NAME": "s", "SCHEDULE_GROUP": "g", "STAGING_BUCKET": "b",
    "INDEX_REGISTRY_TABLE": "t", "SYNC_HISTORY_TABLE": "t", "ORCHESTRATOR_LAMBDA_ARN": "arn",
    "AWS_DEFAULT_REGION": "us-east-1",
}


def _load(monkeypatch, tz):
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    if tz is None:
        monkeypatch.delenv("BRAND_TIMEZONE", raising=False)
    else:
        monkeypatch.setenv("BRAND_TIMEZONE", tz)
    for name in list(sys.modules):
        if name.startswith("common_utils"):
            sys.modules.pop(name)
    spec = importlib.util.spec_from_file_location("sync_schedule_lf", os.path.join(HANDLER_DIR, "lambda_function.py"))
    mod = importlib.util.module_from_spec(spec)
    with patch("boto3.client", return_value=MagicMock()), patch("boto3.resource", return_value=MagicMock()):
        spec.loader.exec_module(mod)
    return mod


def _put(mod, body):
    event = {
        "rawPath": "/sync-schedule",
        "requestContext": {"http": {"method": "PUT"}, "authorizer": {"jwt": {"claims": {"cognito:groups": "[Admin]"}}}},
        "body": json.dumps(body),
    }
    resp = mod.lambda_handler(event, None)
    return resp["statusCode"], json.loads(resp["body"])


@pytest.mark.parametrize(
    "tz,hour,minute,expected",
    [
        ("America/New_York", 1, 0, "Sundays at 1:00 AM (America/New_York)"),
        ("Europe/London", 13, 5, "Sundays at 1:05 PM (Europe/London)"),
        ("Asia/Tokyo", 0, 30, "Sundays at 12:30 AM (Asia/Tokyo)"),
        (None, 12, 0, "Sundays at 12:00 PM (America/New_York)"),
        ("Not/AZone", 1, 0, "Sundays at 1:00 AM (America/New_York)"),
    ],
)
def test_human_readable_uses_brand_timezone(monkeypatch, tz, hour, minute, expected):
    mod = _load(monkeypatch, tz)
    assert mod._human_local({"dayOfWeek": "SUN", "hour": hour, "minute": minute}) == expected
    assert "Eastern" not in expected


def test_put_schedules_in_brand_timezone(monkeypatch):
    mod = _load(monkeypatch, "Europe/Berlin")
    status, body = _put(mod, {"dayOfWeek": "MON", "hour": 2, "minute": 15})
    assert status == 200
    assert body["humanReadable"] == "Mondays at 2:15 AM (Europe/Berlin)"
    kwargs = mod.scheduler.update_schedule.call_args.kwargs
    assert kwargs["ScheduleExpressionTimezone"] == "Europe/Berlin"


@pytest.mark.parametrize("body", [{"hour": "abc"}, {"hour": 24}, {"minute": -1}, {"dayOfWeek": "FUNDAY"}])
def test_put_rejects_bad_input(monkeypatch, body):
    mod = _load(monkeypatch, "UTC")
    status, out = _put(mod, body)
    assert status == 400 and out["error"]
