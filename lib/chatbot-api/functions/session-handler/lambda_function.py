import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

from common_utils import (
    DecimalJSONEncoder,
    get_claims,
    get_logger,
    json_response,
    parse_json_body,
    truncate_text,
)


DDB_TABLE_NAME = os.environ["DDB_TABLE_NAME"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DDB_TABLE_NAME)
logger = get_logger(__name__)

# Operations that write chat turns or the context summary the model reads back.
# Only the chat Lambda (direct Lambda invoke) may call them; through the HTTP
# API a client could otherwise forge assistant answers in its own history or
# inject instructions into the summary. The UI only lists, reads and deletes.
INVOKE_ONLY_OPERATIONS = frozenset({
    "add_session",
    "update_session",
    "append_chat_entry",
    "update_context_summary",
})

# DynamoDB's hard item limit is 400 KB. Stay well under it so a long session
# keeps saving: oversized entries are slimmed, and when the item itself would
# overflow, the oldest turns are dropped.
MAX_ITEM_BYTES = 350_000
MAX_ENTRY_BYTES = 200_000


def _json_size(value) -> int:
    return len(json.dumps(value, cls=DecimalJSONEncoder, default=str).encode("utf-8"))


def _fit_entry(entry):
    """Return the entry unchanged if it fits, else a slimmed copy, else None."""
    if _json_size(entry) <= MAX_ENTRY_BYTES:
        return entry
    if isinstance(entry, dict) and "metadata" in entry:
        slim = {**entry, "metadata": {"truncated": True}}
        logger.warning("Chat entry exceeded %d bytes; dropped its metadata", MAX_ENTRY_BYTES)
        if _json_size(slim) <= MAX_ENTRY_BYTES:
            return slim
    logger.warning("Chat entry exceeded %d bytes even without metadata; rejecting", MAX_ENTRY_BYTES)
    return None


def _is_item_too_large(error: ClientError) -> bool:
    err = error.response.get("Error", {})
    return err.get("Code") == "ValidationException" and "size" in str(err.get("Message", "")).lower()


def _trim_history_and_append(session_id, user_id, new_chat_entry, title_text):
    """Rewrite the session with the oldest turns dropped so the new entry fits."""
    existing = table.get_item(Key={"user_id": user_id, "session_id": session_id}).get("Item") or {}
    history = list(existing.get("chat_history") or []) + [new_chat_entry]
    previous_count = existing.get("message_count", len(existing.get("chat_history") or []))
    item = {
        **existing,
        "user_id": user_id,
        "session_id": session_id,
        "title": existing.get("title") or title_text,
        "time_stamp": utc_now_iso(),
        "chat_history": history,
        "message_count": int(previous_count) + 1,
    }
    dropped = 0
    while len(item["chat_history"]) > 1 and _json_size(item) > MAX_ITEM_BYTES:
        item["chat_history"] = item["chat_history"][1:]
        dropped += 1
    logger.warning(
        "Session item near the DynamoDB size limit; dropped %d oldest chat turns (session=%s)",
        dropped, session_id,
    )
    table.put_item(Item=item)
    return not bool(existing)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get_session(session_id, user_id):
    try:
        response = table.get_item(Key={"user_id": user_id, "session_id": session_id})
        return json_response(200, response.get("Item", {}))
    except ClientError as error:
        logger.exception("DynamoDB error while reading session")
        if error.response["Error"]["Code"] == "ResourceNotFoundException":
            return json_response(404, f"No record found with session id: {session_id}")
        return json_response(500, "An unexpected error occurred")


# message_count lets the metrics Lambda count turns without reading every
# chat_history body. Sessions written before the counter existed are seeded
# from their stored history the first time they are appended to.
_COUNT_READY = "(attribute_exists(message_count) OR attribute_not_exists(chat_history))"


def _append_entry(session_id, user_id, new_chat_entry, *, title_text=None, must_exist=False, return_values="NONE"):
    key = {"user_id": user_id, "session_id": session_id}
    set_parts = [
        "chat_history = list_append(if_not_exists(chat_history, :empty), :new_entry)",
        "time_stamp = :ts",
        "message_count = if_not_exists(message_count, :seed) + :one",
    ]
    values = {":empty": [], ":new_entry": [new_chat_entry], ":ts": utc_now_iso(), ":seed": 0, ":one": 1}
    kwargs = {}
    if title_text is not None:
        set_parts.append("#title = if_not_exists(#title, :title)")
        values[":title"] = title_text
        kwargs["ExpressionAttributeNames"] = {"#title": "title"}
    exists = "attribute_exists(user_id) AND attribute_exists(session_id)"

    def _update(condition):
        return table.update_item(
            Key=key,
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeValues=values,
            ConditionExpression=condition,
            ReturnValues=return_values,
            **kwargs,
        )

    try:
        return _update(f"{exists} AND {_COUNT_READY}" if must_exist else _COUNT_READY)
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        existing = table.get_item(Key=key, ProjectionExpression="chat_history, message_count").get("Item")
        if not existing or "message_count" in existing:
            raise
        values[":seed"] = len(existing.get("chat_history") or [])
        return _update(exists if must_exist else "attribute_exists(chat_history)")


def add_session(session_id, user_id, title, new_chat_entry):
    new_chat_entry = _fit_entry(new_chat_entry)
    if new_chat_entry is None:
        return json_response(413, "This message is too large to save.")
    title_text = truncate_text(title or f"Chat on {utc_now_iso()}", 80).strip() or f"Chat on {utc_now_iso()}"
    try:
        table.put_item(
            Item={
                "user_id": user_id,
                "session_id": session_id,
                "chat_history": [new_chat_entry],
                "message_count": 1,
                "title": title_text,
                "time_stamp": utc_now_iso(),
            },
            ConditionExpression="attribute_not_exists(user_id) AND attribute_not_exists(session_id)",
        )
        return json_response(200, {"created": True, "title": title_text})
    except ClientError as error:
        logger.exception("DynamoDB error while creating session")
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return json_response(409, f"Session already exists: {session_id}")
        if error.response["Error"]["Code"] == "ResourceNotFoundException":
            return json_response(404, f"No record found with session id: {session_id}")
        if _is_item_too_large(error):
            logger.warning("New session item exceeded the DynamoDB size limit (session=%s)", session_id)
            return json_response(413, "This message is too large to save.")
        return json_response(500, "Failed to create the session due to a database error.")


def update_session(session_id, user_id, new_chat_entry):
    new_chat_entry = _fit_entry(new_chat_entry)
    if new_chat_entry is None:
        return json_response(413, "This message is too large to save.")
    try:
        response = _append_entry(session_id, user_id, new_chat_entry, must_exist=True, return_values="UPDATED_NEW")
        return json_response(200, response.get("Attributes", {}))
    except ClientError as error:
        logger.exception("DynamoDB error while updating session")
        error_code = error.response["Error"]["Code"]
        if error_code in ("ResourceNotFoundException", "ConditionalCheckFailedException"):
            return json_response(404, f"No record found with session id: {session_id}")
        if _is_item_too_large(error):
            logger.warning("Session item exceeded the DynamoDB size limit on update (session=%s)", session_id)
            return json_response(413, "This conversation is too long to save. Please start a new chat.")
        return json_response(500, "Failed to update the session due to a database error.")


def append_chat_entry(session_id, user_id, new_chat_entry, title):
    title_text = truncate_text(title or f"Chat on {utc_now_iso()}", 80).strip() or f"Chat on {utc_now_iso()}"
    new_chat_entry = _fit_entry(new_chat_entry)
    if new_chat_entry is None:
        return json_response(413, "This message is too large to save.")
    try:
        response = _append_entry(session_id, user_id, new_chat_entry, title_text=title_text, return_values="ALL_OLD")
        return json_response(
            200,
            {
                "created": not bool(response.get("Attributes")),
                "title": title_text,
            },
        )
    except ClientError as error:
        if _is_item_too_large(error):
            try:
                created = _trim_history_and_append(session_id, user_id, new_chat_entry, title_text)
                return json_response(200, {"created": created, "title": title_text, "trimmed": True})
            except ClientError:
                logger.exception("DynamoDB error while trimming an oversized session")
                return json_response(500, "Failed to save the session due to a database error.")
        logger.exception("DynamoDB error while appending session entry")
        return json_response(500, "Failed to save the session due to a database error.")


def delete_session(session_id, user_id):
    try:
        table.delete_item(Key={"user_id": user_id, "session_id": session_id})
        return json_response(200, {"id": session_id, "deleted": True})
    except ClientError as error:
        logger.exception("DynamoDB error while deleting session")
        if error.response["Error"]["Code"] == "ResourceNotFoundException":
            return json_response(404, {"id": session_id, "deleted": False})
        return json_response(500, {"id": session_id, "deleted": False})


def list_sessions_by_user_id(user_id, limit=50):
    items = []

    try:
        last_evaluated_key = None
        while len(items) < limit:
            query_kwargs = {
                "IndexName": "TimeIndex",
                "ProjectionExpression": "session_id, title, time_stamp",
                "KeyConditionExpression": "user_id = :user_id",
                "ExpressionAttributeValues": {":user_id": user_id},
                "ScanIndexForward": False,
                "Limit": limit - len(items),
            }
            if last_evaluated_key:
                query_kwargs["ExclusiveStartKey"] = last_evaluated_key

            response = table.query(**query_kwargs)
            items.extend(response.get("Items", []))
            last_evaluated_key = response.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break
    except ClientError as error:
        logger.exception("DynamoDB error while listing sessions")
        error_code = error.response["Error"]["Code"]
        if error_code == "ResourceNotFoundException":
            return json_response(404, f"No record found for user id: {user_id}")
        if error_code == "ProvisionedThroughputExceededException":
            return json_response(429, "Request limit exceeded")
        if error_code == "ValidationException":
            return json_response(400, "Invalid input parameters")
        return json_response(500, "Internal server error")
    except Exception:
        logger.exception("Unexpected error while listing sessions")
        return json_response(500, "An unexpected error occurred")

    sorted_items = sorted(items, key=lambda item: item["time_stamp"], reverse=True)
    sessions = [
        {
            "time_stamp": item["time_stamp"],
            "session_id": item["session_id"],
            "title": (item.get("title") or "").strip(),
        }
        for item in sorted_items
    ]
    return json_response(200, sessions)


def delete_user_sessions(user_id):
    sessions_response = list_sessions_by_user_id(user_id, limit=1000)
    if sessions_response["statusCode"] != 200:
        return sessions_response

    sessions = json.loads(sessions_response["body"])
    deleted = []
    for session in sessions:
        result = delete_session(session["session_id"], user_id)
        deleted.append({"id": session["session_id"], "deleted": result["statusCode"] == 200})
    return json_response(200, deleted)


def update_context_summary(session_id, user_id, context_summary):
    try:
        table.update_item(
            Key={"user_id": user_id, "session_id": session_id},
            UpdateExpression="SET context_summary = :summary",
            ExpressionAttributeValues={":summary": context_summary},
            ConditionExpression="attribute_exists(user_id) AND attribute_exists(session_id)",
        )
        return json_response(200, {"updated": True})
    except ClientError:
        logger.exception("DynamoDB error while saving context summary")
        return json_response(500, "Failed to save context summary")




def _is_api_gateway_request(event) -> bool:
    """API Gateway always attaches requestContext; a direct Lambda invoke from
    the chat handler sends only a body. Clients cannot forge this distinction
    because API Gateway builds the event."""
    return bool((event or {}).get("requestContext"))


def _resolve_user_id(event, body_user_id):
    """Derive the user identifier from the API Gateway JWT authorizer when
    present. When invoked directly via Lambda Invoke (no requestContext),
    e.g. from the WebSocket chat handler, fall back to the supplied body
    value, which the chat handler has already derived from the WS authorizer
    principal. An API Gateway request without JWT claims never falls back to
    the body, so a client can't pick whose sessions it reads.

    We key off `cognito:username` because that matches the identifier the
    frontend has been sending all along (Amplify's `.username`), which is what
    historical chat rows are stored under. Falling back to `sub` keeps the
    handler working for tokens that omit `cognito:username` (e.g. unit tests).
    """
    claims = get_claims(event)
    if isinstance(claims, dict):
        jwt_user = claims.get("cognito:username") or claims.get("username") or claims.get("sub")
        if jwt_user:
            return jwt_user
    if _is_api_gateway_request(event):
        return None
    return body_user_id


def lambda_handler(event, context):
    try:
        data = parse_json_body(event)
    except json.JSONDecodeError:
        return json_response(400, "Invalid JSON request body")

    operation = data.get("operation")
    if operation in INVOKE_ONLY_OPERATIONS and _is_api_gateway_request(event):
        logger.warning("Rejected HTTP call to invoke-only session operation %s", operation)
        return json_response(403, "This operation is not available.")

    user_id = _resolve_user_id(event, data.get("user_id"))
    if not user_id:
        return json_response(401, "Unauthorized")
    session_id = data.get("session_id")
    new_chat_entry = data.get("new_chat_entry")
    title = data.get("title")

    if operation == "update_context_summary":
        return update_context_summary(session_id, user_id, data.get("context_summary", ""))
    if operation == "add_session":
        return add_session(session_id, user_id, title, new_chat_entry)
    if operation == "get_session":
        return get_session(session_id, user_id)
    if operation == "update_session":
        return update_session(session_id, user_id, new_chat_entry)
    if operation == "append_chat_entry":
        return append_chat_entry(session_id, user_id, new_chat_entry, title)
    if operation == "list_sessions_by_user_id":
        return list_sessions_by_user_id(user_id)
    if operation == "list_all_sessions_by_user_id":
        return list_sessions_by_user_id(user_id, limit=100)
    if operation == "delete_session":
        return delete_session(session_id, user_id)
    if operation == "delete_user_sessions":
        return delete_user_sessions(user_id)
    return json_response(400, f"Operation not found/allowed! Operation Sent: {truncate_text(operation, 64)}")
