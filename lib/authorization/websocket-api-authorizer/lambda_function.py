"""WebSocket $connect authorizer: verifies a Cognito ID token passed as the
`Authorization` query parameter (browsers can't set headers on WebSocket
upgrades) and returns an Allow policy plus identity context for the chat Lambda.
"""
import json
import logging
import os
import time
import urllib.request

import jwt

logger = logging.getLogger()
logger.setLevel(logging.INFO)

JWKS_TIMEOUT_SECONDS = 5
# An unknown kid triggers at most one JWKS refetch per interval, so tokens with
# random kids can't make every invocation call Cognito.
JWKS_REFRESH_INTERVAL_SECONDS = 60
CLOCK_SKEW_SECONDS = 30
ADMIN_GROUP_NAME = os.environ.get("ADMIN_GROUP_NAME", "Admin")

_jwks_cache: dict[str, jwt.PyJWK] = {}
_jwks_fetched_at: float | None = None


class Unauthorized(Exception):
    pass


def _issuer() -> str:
    region = os.environ["AWS_REGION"]
    return f"https://cognito-idp.{region}.amazonaws.com/{os.environ['USER_POOL_ID']}"


def _fetch_jwks() -> dict[str, jwt.PyJWK]:
    url = f"{_issuer()}/.well-known/jwks.json"
    with urllib.request.urlopen(url, timeout=JWKS_TIMEOUT_SECONDS) as response:
        data = json.loads(response.read())
    keys = {}
    for key in data.get("keys", []):
        if key.get("kid"):
            keys[key["kid"]] = jwt.PyJWK(key)
    return keys


def _signing_key(kid: str) -> jwt.PyJWK:
    """Return the JWK for kid, refetching the JWKS once if the kid is new
    (Cognito rotates keys; a cold cache must not reject fresh tokens)."""
    global _jwks_cache, _jwks_fetched_at
    if kid in _jwks_cache:
        return _jwks_cache[kid]
    now = time.monotonic()
    if _jwks_fetched_at is None or now - _jwks_fetched_at >= JWKS_REFRESH_INTERVAL_SECONDS:
        # Stamp before fetching so a failing or empty fetch is rate-limited too.
        _jwks_fetched_at = now
        _jwks_cache = _fetch_jwks()
    if kid not in _jwks_cache:
        raise Unauthorized("unknown kid")
    return _jwks_cache[kid]


def _groups(claims: dict) -> list[str]:
    raw = claims.get("cognito:groups") or []
    if isinstance(raw, str):
        return [raw]
    return [str(g) for g in raw]


def verify_token(token: str) -> dict:
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise Unauthorized("missing kid")
    key = _signing_key(kid)
    claims = jwt.decode(
        token,
        key=key.key,
        algorithms=["RS256"],
        audience=os.environ["APP_CLIENT_ID"],
        issuer=_issuer(),
        leeway=CLOCK_SKEW_SECONDS,
        options={"require": ["exp", "iat", "iss", "aud", "sub", "token_use"]},
    )
    if claims.get("token_use") != "id":
        raise Unauthorized("not an ID token")
    return claims


def lambda_handler(event, context):
    try:
        token = (event.get("queryStringParameters") or {}).get("Authorization")
        if not token:
            raise Unauthorized("missing token")
        claims = verify_token(token)
    except Exception as e:
        # Never log the token itself.
        logger.warning("Authorization failed: %s", type(e).__name__)
        raise Exception("Unauthorized")

    # `principalId` is required by API Gateway and we keep it as `sub`
    # (the immutable Cognito UUID) for IAM/audit purposes. The chat handler
    # reads `cognito_username` from the propagated context because session rows
    # are keyed off that identifier (matches the frontend's Amplify `.username`).
    # Context values must be strings, numbers or booleans.
    cognito_username = claims.get("cognito:username") or claims.get("username") or claims["sub"]
    return {
        "principalId": claims["sub"],
        "context": {
            "cognito_username": cognito_username,
            "email": claims.get("email", ""),
            "name": claims.get("name", ""),
            "is_admin": ADMIN_GROUP_NAME in _groups(claims),
        },
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{
                "Action": "execute-api:Invoke",
                "Effect": "Allow",
                "Resource": event["methodArn"],
            }],
        },
    }
