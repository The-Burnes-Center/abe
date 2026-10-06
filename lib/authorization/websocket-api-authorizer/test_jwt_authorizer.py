"""
Unit tests for the WebSocket JWT authorizer Lambda (PyJWT).
Covers: valid ID token -> Allow + context, missing token, unknown/missing kid,
expired token, wrong audience, wrong issuer, access token rejected, bad
signature, unknown kid triggers one JWKS refresh, JWKS fetch failure.
The JWKS fetch is patched, so no real HTTP calls are made.
"""
import importlib.util
import json
import os
import time
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

REGION = "us-east-1"
USER_POOL_ID = "us-east-1_testpool"
APP_CLIENT_ID = "testclientid"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}"
METHOD_ARN = "arn:aws:execute-api:us-east-1:123456789:abc/prod/$connect"
KID = "test-key-id"


def _new_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


RSA_PRIVATE = _new_key()
OTHER_PRIVATE = _new_key()


def _jwk(private_key, kid):
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": kid, "alg": "RS256", "use": "sig"})
    return jwk


def _make_token(*, kid=KID, private_key=None, exp_offset=3600, aud=APP_CLIENT_ID, iss=ISSUER,
                token_use="id", extra=None):
    now = int(time.time())
    claims = {
        "sub": "user-sub-123",
        "aud": aud,
        "iss": iss,
        "exp": now + exp_offset,
        "iat": now - 10,
        "token_use": token_use,
        "cognito:username": "alice",
        "email": "alice@example.org",
    }
    claims.update(extra or {})
    headers = {"kid": kid} if kid else {}
    return jwt.encode(claims, private_key or RSA_PRIVATE, algorithm="RS256", headers=headers)


@pytest.fixture()
def lf(monkeypatch):
    monkeypatch.setenv("AWS_REGION", REGION)
    monkeypatch.setenv("USER_POOL_ID", USER_POOL_ID)
    monkeypatch.setenv("APP_CLIENT_ID", APP_CLIENT_ID)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lambda_function.py")
    spec = importlib.util.spec_from_file_location("ws_authorizer_lf", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _jwks(*jwks):
    return {j["kid"]: jwt.PyJWK(j) for j in jwks}


def _event(token):
    params = {"Authorization": token} if token is not None else None
    return {"queryStringParameters": params, "methodArn": METHOD_ARN}


def _call(lf, token, jwks=None):
    with patch.object(lf, "_fetch_jwks", return_value=jwks or _jwks(_jwk(RSA_PRIVATE, KID))) as fetch:
        result = lf.lambda_handler(_event(token), None)
    return result, fetch


class TestValidToken:
    def test_returns_allow_policy_for_method_arn(self, lf):
        result, _ = _call(lf, _make_token())
        statement = result["policyDocument"]["Statement"][0]
        assert statement["Effect"] == "Allow"
        assert statement["Resource"] == METHOD_ARN
        assert result["principalId"] == "user-sub-123"

    def test_context_carries_identity(self, lf):
        result, _ = _call(lf, _make_token(extra={"name": "Alice A", "cognito:groups": ["Admin"]}))
        ctx = result["context"]
        assert ctx["cognito_username"] == "alice"
        assert ctx["email"] == "alice@example.org"
        assert ctx["name"] == "Alice A"
        assert ctx["is_admin"] is True
        assert "role" not in ctx

    def test_non_admin_context(self, lf):
        result, _ = _call(lf, _make_token(extra={"cognito:groups": ["AdminViewer"]}))
        assert result["context"]["is_admin"] is False

    def test_jwks_cached_between_calls(self, lf):
        with patch.object(lf, "_fetch_jwks", return_value=_jwks(_jwk(RSA_PRIVATE, KID))) as fetch:
            lf.lambda_handler(_event(_make_token()), None)
            lf.lambda_handler(_event(_make_token()), None)
        assert fetch.call_count == 1


class TestRejected:
    @pytest.mark.parametrize("token", [None, ""])
    def test_missing_token(self, lf, token):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, token)

    def test_expired(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(exp_offset=-3600))

    def test_wrong_audience(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(aud="some-other-client"))

    def test_wrong_issuer(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(iss="https://cognito-idp.us-east-1.amazonaws.com/us-east-1_other"))

    def test_access_token_rejected(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(token_use="access"))

    def test_bad_signature(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(private_key=OTHER_PRIVATE))

    def test_missing_kid(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(kid=None))

    def test_garbage_token(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, "not-a-jwt")

    def test_hs256_token_rejected(self, lf):
        token = jwt.encode({"sub": "x", "aud": APP_CLIENT_ID, "iss": ISSUER, "token_use": "id",
                            "exp": int(time.time()) + 60, "iat": int(time.time())},
                           "secret", algorithm="HS256", headers={"kid": KID})
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, token)

    def test_jwks_fetch_failure(self, lf):
        with patch.object(lf, "_fetch_jwks", side_effect=OSError("network down")):
            with pytest.raises(Exception, match="Unauthorized"):
                lf.lambda_handler(_event(_make_token()), None)


class TestUnknownKid:
    def test_unknown_kid_refreshes_jwks_once(self, lf):
        old = _jwks(_jwk(OTHER_PRIVATE, "old-kid"))
        rotated = _jwks(_jwk(OTHER_PRIVATE, "old-kid"), _jwk(RSA_PRIVATE, KID))
        with patch.object(lf, "_fetch_jwks", side_effect=[old, rotated]) as fetch:
            # Prime the cache with the old key set.
            lf._signing_key("old-kid")
            lf._jwks_fetched_at -= lf.JWKS_REFRESH_INTERVAL_SECONDS
            result = lf.lambda_handler(_event(_make_token()), None)
        assert fetch.call_count == 2
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Allow"

    def test_unknown_kid_still_unknown_after_refresh(self, lf):
        with pytest.raises(Exception, match="Unauthorized"):
            _call(lf, _make_token(kid="never-seen"))

    def test_failed_fetch_is_rate_limited(self, lf):
        with patch.object(lf, "_fetch_jwks", side_effect=OSError("down")) as fetch:
            for _ in range(3):
                with pytest.raises(Exception, match="Unauthorized"):
                    lf.lambda_handler(_event(_make_token()), None)
        assert fetch.call_count == 1

    def test_empty_jwks_is_rate_limited(self, lf):
        with patch.object(lf, "_fetch_jwks", return_value={}) as fetch:
            for _ in range(3):
                with pytest.raises(Exception, match="Unauthorized"):
                    lf.lambda_handler(_event(_make_token()), None)
        assert fetch.call_count == 1

    def test_refresh_is_rate_limited(self, lf):
        keys = _jwks(_jwk(RSA_PRIVATE, KID))
        with patch.object(lf, "_fetch_jwks", return_value=keys) as fetch:
            lf.lambda_handler(_event(_make_token()), None)
            for _ in range(3):
                with pytest.raises(Exception, match="Unauthorized"):
                    lf.lambda_handler(_event(_make_token(kid="random-kid")), None)
        assert fetch.call_count == 1
