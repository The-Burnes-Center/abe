"""Tests for the user-admin Lambda (moto-backed Cognito)."""
import importlib.util
import json
import os
import sys
from unittest.mock import patch

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
LAYER_DIR = os.path.abspath(os.path.join(HANDLER_DIR, "..", "layers", "python-common", "python"))
if LAYER_DIR not in sys.path:
    sys.path.insert(0, LAYER_DIR)

ADMIN_EMAIL = "boss@example.org"


@pytest.fixture()
def ctx(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    with mock_aws():
        idp = boto3.client("cognito-idp", region_name="us-east-1")
        pool_id = idp.create_user_pool(PoolName="p", UsernameAttributes=["email"])["UserPool"]["Id"]
        idp.create_group(UserPoolId=pool_id, GroupName="Admin")
        boss = idp.admin_create_user(
            UserPoolId=pool_id, Username=ADMIN_EMAIL,
            UserAttributes=[{"Name": "email", "Value": ADMIN_EMAIL}],
            MessageAction="SUPPRESS",
        )["User"]
        idp.admin_add_user_to_group(UserPoolId=pool_id, Username=boss["Username"], GroupName="Admin")
        monkeypatch.setenv("USER_POOL_ID", pool_id)
        monkeypatch.setenv("ADMIN_GROUP_NAME", "Admin")
        for name in list(sys.modules):
            if name.startswith("common_utils"):
                sys.modules.pop(name)
        spec = importlib.util.spec_from_file_location("user_admin_lf", os.path.join(HANDLER_DIR, "lambda_function.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        yield mod, idp, pool_id, boss


def _event(method, path, body=None, groups='["Admin"]', claims=None, query=None):
    base_claims = {"cognito:groups": groups, "email": ADMIN_EMAIL, "cognito:username": "boss-sub"}
    base_claims.update(claims or {})
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}, "authorizer": {"jwt": {"claims": base_claims}}},
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query,
    }


def _call(lf, *args, **kwargs):
    resp = lf.lambda_handler(_event(*args, **kwargs), None)
    resp["json"] = json.loads(resp["body"])
    return resp


def _invite(lf, email="new@example.org", is_admin=False):
    return _call(lf, "POST", "/admin/users", {"email": email, "isAdmin": is_admin})


def test_non_admin_forbidden(ctx):
    lf, *_ = ctx
    assert _call(lf, "GET", "/admin/users", groups="[Viewers]")["statusCode"] == 403


def test_list_users_reports_admin_flag(ctx):
    lf, *_ = ctx
    _invite(lf)
    body = _call(lf, "GET", "/admin/users")["json"]
    by_email = {u["email"]: u for u in body["users"]}
    assert by_email[ADMIN_EMAIL]["isAdmin"] is True
    assert by_email["new@example.org"]["isAdmin"] is False
    assert set(by_email["new@example.org"]) == {"username", "email", "status", "enabled", "isAdmin", "createdAt"}
    assert "nextToken" in body


def test_list_users_paginates(ctx, monkeypatch):
    lf, *_ = ctx
    monkeypatch.setattr(lf, "PAGE_SIZE", 1)
    _invite(lf)
    first = _call(lf, "GET", "/admin/users")["json"]
    assert len(first["users"]) == 1 and first["nextToken"]
    second = _call(lf, "GET", "/admin/users", query={"nextToken": first["nextToken"]})["json"]
    assert second["users"][0]["username"] != first["users"][0]["username"]


def test_invite_admin_user(ctx):
    lf, idp, pool_id, _ = ctx
    resp = _invite(lf, "Second@Example.org", is_admin=True)
    assert resp["statusCode"] == 201
    user = resp["json"]["user"]
    assert user["email"] == "second@example.org" and user["isAdmin"] is True
    groups = idp.admin_list_groups_for_user(UserPoolId=pool_id, Username=user["username"])["Groups"]
    assert [g["GroupName"] for g in groups] == ["Admin"]


def test_invite_existing_user_conflicts(ctx):
    lf, *_ = ctx
    _invite(lf)
    resp = _invite(lf)
    assert resp["statusCode"] == 409
    assert resp["json"]["error"]


@pytest.mark.parametrize("email", ["", "nope", "a@b", "a b@example.org", "x" * 250 + "@example.org"])
def test_invite_rejects_bad_email(ctx, email):
    lf, *_ = ctx
    assert _invite(lf, email)["statusCode"] == 400


def test_invite_rejects_non_boolean_admin(ctx):
    lf, *_ = ctx
    assert _call(lf, "POST", "/admin/users", {"email": "a@example.org", "isAdmin": "yes"})["statusCode"] == 400


def test_grant_and_revoke_admin(ctx):
    lf, idp, pool_id, _ = ctx
    username = _invite(lf)["json"]["user"]["username"]
    assert _call(lf, "POST", f"/admin/users/{username}/admin", {"isAdmin": True})["statusCode"] == 200
    assert _call(lf, "POST", f"/admin/users/{username}/admin", {"isAdmin": False})["statusCode"] == 200
    assert idp.admin_list_groups_for_user(UserPoolId=pool_id, Username=username)["Groups"] == []


@pytest.mark.parametrize(
    "method,suffix,body",
    [("POST", "/admin", {"isAdmin": False}), ("POST", "/disable", None), ("DELETE", "", None)],
)
def test_admin_cannot_lock_themselves_out(ctx, method, suffix, body):
    lf, idp, pool_id, boss = ctx
    resp = _call(lf, method, f"/admin/users/{boss['Username']}{suffix}", body)
    assert resp["statusCode"] == 400
    user = idp.admin_get_user(UserPoolId=pool_id, Username=boss["Username"])
    assert user["Enabled"] is True


def test_self_guard_matches_url_encoded_email(ctx):
    lf, *_ = ctx
    resp = _call(lf, "POST", "/admin/users/boss%40example.org/disable")
    assert resp["statusCode"] == 400


def test_disable_enable_delete(ctx):
    lf, idp, pool_id, _ = ctx
    username = _invite(lf)["json"]["user"]["username"]
    assert _call(lf, "POST", f"/admin/users/{username}/disable")["json"]["enabled"] is False
    assert idp.admin_get_user(UserPoolId=pool_id, Username=username)["Enabled"] is False
    assert _call(lf, "POST", f"/admin/users/{username}/enable")["json"]["enabled"] is True
    assert _call(lf, "DELETE", f"/admin/users/{username}")["statusCode"] == 200
    assert _call(lf, "POST", f"/admin/users/{username}/enable")["statusCode"] == 404


def test_resend_invite(ctx):
    lf, *_ = ctx
    username = _invite(lf)["json"]["user"]["username"]
    with patch.object(lf.cognito, "admin_create_user", wraps=lf.cognito.admin_create_user) as create:
        resp = _call(lf, "POST", f"/admin/users/{username}/resend-invite")
    assert resp["statusCode"] == 200
    assert create.call_args.kwargs["MessageAction"] == "RESEND"


def test_resend_for_confirmed_user_is_friendly_409(ctx):
    lf, *_ = ctx
    username = _invite(lf)["json"]["user"]["username"]
    err = ClientError({"Error": {"Code": "UnsupportedUserStateException", "Message": "internal detail"}}, "AdminCreateUser")
    with patch.object(lf.cognito, "admin_create_user", side_effect=err):
        resp = _call(lf, "POST", f"/admin/users/{username}/resend-invite")
    assert resp["statusCode"] == 409
    assert "internal detail" not in resp["body"]


def test_unknown_route_404(ctx):
    lf, *_ = ctx
    assert _call(lf, "PUT", "/admin/users/x/admin")["statusCode"] == 404
    assert _call(lf, "GET", "/admin/other")["statusCode"] == 404


def test_invalid_json_body_400(ctx):
    lf, *_ = ctx
    event = _event("POST", "/admin/users")
    event["body"] = "{not json"
    assert lf.lambda_handler(event, None)["statusCode"] == 400
