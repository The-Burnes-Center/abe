"""Admin API for managing who can sign in (invite-only Cognito user pool).

Routes (all admin-only, behind the HTTP API JWT authorizer):
  GET    /admin/users?nextToken=
  POST   /admin/users                         { email, isAdmin? }
  POST   /admin/users/{username}/admin        { isAdmin }
  POST   /admin/users/{username}/disable
  POST   /admin/users/{username}/enable
  POST   /admin/users/{username}/resend-invite
  DELETE /admin/users/{username}

Admins can't remove their own admin rights, disable or delete themselves, so a
deployment can't be locked out by accident.
"""
import json
import os
import re
from urllib.parse import unquote

import boto3
from botocore.exceptions import ClientError

from common_utils import get_audit_actor_label, get_claims, get_logger, json_response, require_admin

USER_POOL_ID = os.environ["USER_POOL_ID"]
ADMIN_GROUP_NAME = os.environ.get("ADMIN_GROUP_NAME", "Admin")
PAGE_SIZE = 50
MAX_EMAIL_LENGTH = 254
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

cognito = boto3.client("cognito-idp")
logger = get_logger(__name__)

_ERROR_MAP = {
    "UserNotFoundException": (404, "That user doesn't exist."),
    "UsernameExistsException": (409, "A user with that email already exists."),
    "UnsupportedUserStateException": (409, "This user has already accepted their invitation."),
    "InvalidParameterException": (400, "The request was not valid."),
    "TooManyRequestsException": (429, "Too many requests. Please wait a moment and try again."),
    "LimitExceededException": (429, "Too many requests. Please wait a moment and try again."),
    "CodeDeliveryFailureException": (502, "The invitation email could not be sent."),
}


class RequestError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _error(status: int, message: str) -> dict:
    return json_response(status, {"error": message})


def _attributes(user: dict) -> dict:
    attrs = user.get("Attributes") or user.get("UserAttributes") or []
    return {a["Name"]: a["Value"] for a in attrs}


def _admin_usernames() -> set[str]:
    names = set()
    kwargs = {"UserPoolId": USER_POOL_ID, "GroupName": ADMIN_GROUP_NAME, "Limit": 60}
    while True:
        resp = cognito.list_users_in_group(**kwargs)
        names.update(u["Username"] for u in resp.get("Users", []))
        token = resp.get("NextToken")
        if not token:
            return names
        kwargs["NextToken"] = token


def _serialize(user: dict, admin_usernames: set[str]) -> dict:
    created = user.get("UserCreateDate")
    return {
        "username": user["Username"],
        "email": _attributes(user).get("email", ""),
        "status": user.get("UserStatus", ""),
        "enabled": bool(user.get("Enabled", True)),
        "isAdmin": user["Username"] in admin_usernames,
        "createdAt": created.isoformat() if hasattr(created, "isoformat") else created,
    }


def _caller_ids(event) -> set[str]:
    claims = get_claims(event)
    ids = {claims.get("cognito:username"), claims.get("username"), claims.get("sub"), claims.get("email")}
    return {str(i).lower() for i in ids if i}


def _target_ids(user: dict) -> set[str]:
    attrs = _attributes(user)
    ids = {user.get("Username"), attrs.get("sub"), attrs.get("email")}
    return {str(i).lower() for i in ids if i}


def _get_user(username: str) -> dict:
    return cognito.admin_get_user(UserPoolId=USER_POOL_ID, Username=username)


def _ensure_not_self(event, username: str, action: str) -> dict:
    user = _get_user(username)
    if _caller_ids(event) & _target_ids(user):
        raise RequestError(400, f"You can't {action} your own account.")
    return user


def _body(event) -> dict:
    raw = event.get("body")
    if not raw:
        return {}
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        raise RequestError(400, "Request body must be valid JSON.")
    if not isinstance(data, dict):
        raise RequestError(400, "Request body must be a JSON object.")
    return data


# --- Handlers ---------------------------------------------------------------


def list_users(event) -> dict:
    params = event.get("queryStringParameters") or {}
    kwargs = {"UserPoolId": USER_POOL_ID, "Limit": PAGE_SIZE}
    if params.get("nextToken"):
        kwargs["PaginationToken"] = params["nextToken"]
    resp = cognito.list_users(**kwargs)
    admins = _admin_usernames()
    return json_response(200, {
        "users": [_serialize(u, admins) for u in resp.get("Users", [])],
        "nextToken": resp.get("PaginationToken"),
    })


def create_user(event) -> dict:
    data = _body(event)
    email = str(data.get("email") or "").strip().lower()
    if not email or len(email) > MAX_EMAIL_LENGTH or not EMAIL_PATTERN.match(email):
        raise RequestError(400, "Enter a valid email address.")
    is_admin = data.get("isAdmin", False)
    if not isinstance(is_admin, bool):
        raise RequestError(400, "isAdmin must be true or false.")

    resp = cognito.admin_create_user(
        UserPoolId=USER_POOL_ID,
        Username=email,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "email_verified", "Value": "true"},
        ],
        DesiredDeliveryMediums=["EMAIL"],
    )
    user = resp["User"]
    if is_admin:
        cognito.admin_add_user_to_group(UserPoolId=USER_POOL_ID, Username=user["Username"], GroupName=ADMIN_GROUP_NAME)
    _audit(event, "user_invited", email, {"isAdmin": is_admin})
    return json_response(201, {"user": _serialize(user, {user["Username"]} if is_admin else set())})


def set_admin(event, username: str) -> dict:
    is_admin = _body(event).get("isAdmin")
    if not isinstance(is_admin, bool):
        raise RequestError(400, "isAdmin must be true or false.")
    if is_admin:
        user = _get_user(username)
        cognito.admin_add_user_to_group(UserPoolId=USER_POOL_ID, Username=user["Username"], GroupName=ADMIN_GROUP_NAME)
    else:
        user = _ensure_not_self(event, username, "remove admin access from")
        cognito.admin_remove_user_from_group(UserPoolId=USER_POOL_ID, Username=user["Username"], GroupName=ADMIN_GROUP_NAME)
    _audit(event, "admin_granted" if is_admin else "admin_revoked", username)
    return json_response(200, {"username": user["Username"], "isAdmin": is_admin})


def disable_user(event, username: str) -> dict:
    user = _ensure_not_self(event, username, "disable")
    cognito.admin_disable_user(UserPoolId=USER_POOL_ID, Username=user["Username"])
    _audit(event, "user_disabled", username)
    return json_response(200, {"username": user["Username"], "enabled": False})


def enable_user(event, username: str) -> dict:
    user = _get_user(username)
    cognito.admin_enable_user(UserPoolId=USER_POOL_ID, Username=user["Username"])
    _audit(event, "user_enabled", username)
    return json_response(200, {"username": user["Username"], "enabled": True})


def resend_invite(event, username: str) -> dict:
    user = _get_user(username)
    # With email as the username attribute, AdminCreateUser only accepts the
    # email form of the username (not the generated sub-style username).
    cognito.admin_create_user(
        UserPoolId=USER_POOL_ID,
        Username=_attributes(user).get("email") or user["Username"],
        MessageAction="RESEND",
        DesiredDeliveryMediums=["EMAIL"],
    )
    _audit(event, "invite_resent", username)
    return json_response(200, {"username": user["Username"], "resent": True})


def delete_user(event, username: str) -> dict:
    user = _ensure_not_self(event, username, "delete")
    cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=user["Username"])
    _audit(event, "user_deleted", username)
    return json_response(200, {"username": user["Username"], "deleted": True})


def _audit(event, action: str, target: str, details: dict | None = None) -> None:
    logger.info(json.dumps({
        "audit": action,
        "actor": get_audit_actor_label(event),
        "target": target,
        **(details or {}),
    }))


_USER_ACTIONS = {
    ("POST", "admin"): set_admin,
    ("POST", "disable"): disable_user,
    ("POST", "enable"): enable_user,
    ("POST", "resend-invite"): resend_invite,
}


def _route(event):
    method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
    parts = [p for p in (event.get("rawPath") or "").strip("/").split("/") if p]
    if parts[:2] != ["admin", "users"]:
        return None
    rest = parts[2:]
    if not rest:
        return {"GET": list_users, "POST": create_user}.get(method)
    username = unquote(rest[0]).strip()
    if not username:
        return None
    if len(rest) == 1 and method == "DELETE":
        return lambda e: delete_user(e, username)
    if len(rest) == 2 and (method, rest[1]) in _USER_ACTIONS:
        handler = _USER_ACTIONS[(method, rest[1])]
        return lambda e: handler(e, username)
    return None


def lambda_handler(event, context):
    denied = require_admin(event)
    if denied:
        return denied

    handler = _route(event)
    if handler is None:
        return _error(404, "Not found")

    try:
        return handler(event)
    except RequestError as e:
        return _error(e.status, e.message)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        logger.warning("Cognito error %s on %s: %s", code, event.get("rawPath"), e)
        status, message = _ERROR_MAP.get(code, (500, "Something went wrong. Please try again."))
        return _error(status, message)
    except Exception:
        logger.exception("User admin request failed")
        return _error(500, "Something went wrong. Please try again.")
