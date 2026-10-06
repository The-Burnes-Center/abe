"""Tests for the Cognito PreSignUp trigger (domain allowlist, fail closed)."""
import importlib.util
import os

import pytest

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lambda_function.py")
_spec = importlib.util.spec_from_file_location("pre_signup_lf", _PATH)
lf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lf)


def _event(email, trigger="PreSignUp_SignUp"):
    return {
        "triggerSource": trigger,
        "request": {"userAttributes": {"email": email}},
        "response": {"autoConfirmUser": False, "autoVerifyEmail": False, "autoVerifyPhone": False},
    }


@pytest.fixture()
def domains(monkeypatch):
    monkeypatch.setenv("ALLOWED_SIGNUP_DOMAINS", "example.org, Partner.EDU")


def test_admin_create_user_always_allowed(monkeypatch):
    monkeypatch.delenv("ALLOWED_SIGNUP_DOMAINS", raising=False)
    event = _event("anyone@anywhere.com", trigger="PreSignUp_AdminCreateUser")
    assert lf.lambda_handler(event, None) is event


@pytest.mark.parametrize("email", ["a@example.org", "B@PARTNER.edu", " c@example.org "])
def test_allowed_domain_passes_without_auto_confirm(domains, email):
    out = lf.lambda_handler(_event(email), None)
    assert out["response"]["autoConfirmUser"] is False
    assert out["response"]["autoVerifyEmail"] is False


@pytest.mark.parametrize(
    "email",
    [
        "a@evil.com",
        "a@sub.example.org",
        "a@example.org.evil.com",
        "a@notexample.org",
        "a@b@example.org",
        "example.org",
        "",
        "@example.org",
    ],
)
def test_other_domains_rejected(domains, email):
    with pytest.raises(Exception, match="Sign-up is not available"):
        lf.lambda_handler(_event(email), None)


@pytest.mark.parametrize("value", [None, "", " , "])
def test_empty_allowlist_rejects_everyone(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("ALLOWED_SIGNUP_DOMAINS", raising=False)
    else:
        monkeypatch.setenv("ALLOWED_SIGNUP_DOMAINS", value)
    with pytest.raises(Exception, match="Sign-up is not available"):
        lf.lambda_handler(_event("a@example.org"), None)


def test_external_provider_uses_allowlist(domains):
    lf.lambda_handler(_event("a@example.org", trigger="PreSignUp_ExternalProvider"), None)
    with pytest.raises(Exception):
        lf.lambda_handler(_event("a@evil.com", trigger="PreSignUp_ExternalProvider"), None)


def test_malformed_event_fails_closed(domains):
    with pytest.raises(Exception, match="Sign-up is not available"):
        lf.lambda_handler({"triggerSource": "PreSignUp_SignUp", "request": "garbage"}, None)
