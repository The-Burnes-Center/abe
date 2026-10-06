"""Tests for the shared Cognito-group admin check in common_utils.auth."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "python"))

from common_utils.auth import (  # noqa: E402
    get_audit_actor_label,
    get_groups,
    is_admin,
    require_admin,
)


def _event(groups=None, **extra_claims):
    claims = dict(extra_claims)
    if groups is not None:
        claims["cognito:groups"] = groups
    return {"requestContext": {"authorizer": {"jwt": {"claims": claims}}}}


@pytest.mark.parametrize(
    "raw,expected",
    [
        (["Admin", "Viewers"], ["Admin", "Viewers"]),
        ('["Admin","Viewers"]', ["Admin", "Viewers"]),
        ('["Admin", "Viewers"]', ["Admin", "Viewers"]),
        ("[Admin Viewers]", ["Admin", "Viewers"]),
        ("[Admin, Viewers]", ["Admin", "Viewers"]),
        ("[Admin]", ["Admin"]),
        ("Admin", ["Admin"]),
        ("", []),
        ("[]", []),
        ([], []),
    ],
)
def test_get_groups_parses_every_claim_encoding(raw, expected):
    assert get_groups(_event(raw)) == expected


@pytest.mark.parametrize(
    "raw",
    [["Admin"], '["Admin"]', "[Admin]", "[Viewers, Admin]", "[Viewers Admin]", "Admin"],
)
def test_is_admin_true_for_admin_group(raw):
    assert is_admin(_event(raw)) is True


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        ["Viewers"],
        "AdminViewer",
        "[NotAdmin]",
        '["admin"]',
        ["Administrators"],
        "[SuperAdmin, Viewers]",
    ],
)
def test_is_admin_false_without_exact_match(raw):
    assert is_admin(_event(raw)) is False


def test_custom_role_claim_is_ignored():
    event = _event(None, **{"custom:role": json.dumps(["Admin"])})
    assert is_admin(event) is False


def test_missing_request_context_is_not_admin():
    assert is_admin({}) is False
    assert is_admin(None) is False


def test_require_admin_returns_403_for_non_admin():
    resp = require_admin(_event(["Viewers"]))
    assert resp["statusCode"] == 403
    assert "error" in json.loads(resp["body"])


def test_require_admin_returns_none_for_admin():
    assert require_admin(_event("[Admin]")) is None


def test_audit_actor_prefers_name_then_email():
    assert get_audit_actor_label(_event(None, name="Ada", email="a@x.org")) == "Ada"
    assert get_audit_actor_label(_event(None, email="a@x.org")) == "a@x.org"
    assert get_audit_actor_label(_event(None, **{"cognito:username": "u1"})) == "u1"
    assert get_audit_actor_label(_event(None)) == "Admin"
