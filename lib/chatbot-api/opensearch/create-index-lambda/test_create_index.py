"""Tests for the OpenSearch create-index custom resource handler."""
import importlib.util
import os
from unittest.mock import MagicMock, patch

import pytest
from opensearchpy.exceptions import AuthorizationException, RequestError

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lambda_function.py")


@pytest.fixture()
def lf(monkeypatch):
    monkeypatch.setenv("COLLECTION_ENDPOINT", "abc.us-east-1.aoss.amazonaws.com")
    monkeypatch.setenv("INDEX_NAME", "kb-index")
    monkeypatch.setenv("EMBEDDING_DIM", "1024")
    monkeypatch.setenv("REGION", "us-east-1")
    spec = importlib.util.spec_from_file_location("create_index_lf", _PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)
    return mod


def _context(remaining_ms=900_000):
    ctx = MagicMock()
    ctx.get_remaining_time_in_millis.return_value = remaining_ms
    return ctx


def _run(lf, request_type, client, context=None, **extra):
    with patch.object(lf, "_client", return_value=client):
        return lf.lambda_handler({"RequestType": request_type, **extra}, context or _context())


def _already_exists():
    return RequestError(400, "resource_already_exists_exception", {"error": "index exists"})


def test_create_creates_index(lf):
    client = MagicMock()
    out = _run(lf, "Create", client)
    assert out["PhysicalResourceId"] == "kb-index"
    assert out["Data"]["Created"] == "true"
    body = client.indices.create.call_args.kwargs["body"]
    assert '"dimension": 1024' in body


@pytest.mark.parametrize("request_type", ["Create", "Update"])
def test_already_exists_is_success(lf, request_type):
    client = MagicMock()
    client.indices.create.side_effect = _already_exists()
    out = _run(lf, request_type, client)
    assert out["Data"]["Created"] == "false"


def test_delete_is_noop(lf):
    client = MagicMock()
    out = _run(lf, "Delete", client, PhysicalResourceId="kb-index")
    assert out["PhysicalResourceId"] == "kb-index"
    client.indices.create.assert_not_called()


def test_other_request_errors_fail_loudly(lf):
    client = MagicMock()
    client.indices.create.side_effect = RequestError(400, "mapper_parsing_exception", {})
    with pytest.raises(RuntimeError, match="mapper_parsing_exception"):
        _run(lf, "Create", client)


def test_retries_403_until_policy_propagates(lf):
    client = MagicMock()
    client.indices.create.side_effect = [
        AuthorizationException(403, "security_exception", {}),
        AuthorizationException(403, "security_exception", {}),
        {"acknowledged": True},
    ]
    out = _run(lf, "Create", client)
    assert client.indices.create.call_count == 3
    assert out["Data"]["Created"] == "true"


def test_gives_up_when_time_runs_out(lf):
    client = MagicMock()
    client.indices.create.side_effect = AuthorizationException(403, "security_exception", {})
    with pytest.raises(RuntimeError, match="403"):
        _run(lf, "Create", client, context=_context(remaining_ms=lf.RESERVED_MS + 500))
    assert client.indices.create.call_count == 1


def test_unknown_request_type_raises(lf):
    with pytest.raises(ValueError):
        _run(lf, "Bogus", MagicMock())
