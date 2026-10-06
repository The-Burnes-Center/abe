import json
import os
from datetime import datetime, timezone

import boto3

from common_utils import extract_json_object, get_logger, truncate_text
from common_utils.models import fast_model_id


ANALYTICS_TABLE = os.environ["ANALYTICS_TABLE_NAME"]
MODEL_ID = fast_model_id()

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(ANALYTICS_TABLE)
bedrock = boto3.client("bedrock-runtime")
logger = get_logger(__name__)

# Topic taxonomy for analytics. Override per deployment with the FAQ_CATEGORIES
# env var (comma-separated). Keep "Greeting/Small Talk" and "Other" — the
# handler logic below references them.
DEFAULT_CATEGORIES = [
    "General Question",
    "How-To / Guidance",
    "Document Lookup",
    "Data / Records",
    "Account & Access",
    "Technical Issue",
    "Greeting/Small Talk",
    "Other",
]
_env_categories = os.environ.get("FAQ_CATEGORIES", "").strip()
CATEGORIES = [c.strip() for c in _env_categories.split(",") if c.strip()] or DEFAULT_CATEGORIES

CLASSIFICATION_PROMPT = f"""Classify the following user question into exactly one category from this list:
{json.dumps(CATEGORIES)}

Return ONLY valid JSON with no explanation:
{{"topic": "<category>", "confidence": <0.0-1.0>}}"""


def classify_question(user_message: str) -> dict:
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 100,
            "messages": [
                {"role": "user", "content": f"{CLASSIFICATION_PROMPT}\n\nQuestion: {user_message}"}
            ],
        }
    )

    response = bedrock.invoke_model(modelId=MODEL_ID, body=body, contentType="application/json")
    result = json.loads(response["body"].read())
    content = result.get("content") or []
    text = ""
    if content and isinstance(content[0], dict):
        text = (content[0].get("text") or "").strip()

    try:
        parsed = extract_json_object(text)
    except Exception:
        logger.warning("Classifier returned non-JSON content: %s", text[:200])
        return {"topic": "Other", "confidence": 0.0}

    topic = parsed.get("topic", "Other")
    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    if topic not in CATEGORIES:
        topic = "Other"

    return {"topic": topic, "confidence": max(0.0, min(confidence, 1.0))}


def lambda_handler(event, context):
    try:
        user_message = (event.get("userMessage") or "").strip()
        user_id = event.get("userId", "")
        session_id = event.get("sessionId", "")
        display_name = truncate_text(event.get("displayName", ""), 200)
        timestamp = event.get("timestamp", datetime.now(timezone.utc).isoformat())

        if len(user_message) < 3:
            return {"statusCode": 200, "body": "Skipped: message too short"}

        classification = classify_question(user_message)
        topic = classification.get("topic", "Other")
        confidence = classification.get("confidence", 0.0)

        if topic == "Greeting/Small Talk":
            return {"statusCode": 200, "body": f"Skipped: topic={topic}"}

        if confidence < 0.6:
            topic = "Other"

        table.put_item(
            Item={
                "topic": topic,
                "timestamp": timestamp,
                "question": truncate_text(user_message, 500),
                "user_id": user_id,
                "session_id": session_id,
                "display_name": display_name,
                "date_key": timestamp[:10],
                "confidence": str(confidence),
            }
        )
        return {"statusCode": 200, "body": f"Classified as {topic} ({confidence})"}
    except Exception:
        logger.exception("FAQ classification error")
        return {"statusCode": 500, "body": "Classification failed"}
