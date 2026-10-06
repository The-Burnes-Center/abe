"""
Context Summarizer Lambda -- compresses long chat histories into structured summaries.

Called when a conversation exceeds the context window budget. Uses the fast
model (FAST_MODEL_ID) to distill the conversation into a structured JSON
summary covering key facts, questions answered, data retrieved, and the user's
active topic.

Summarization strategy (two-tier fallback):
  1. **Structured** (primary): asks the LLM to return JSON conforming to the
     ``ConversationSummary`` Pydantic schema. The response is parsed and
     validated. If the response contains no JSON object (``ValueError`` from
     ``extract_json_object``) or fails Pydantic validation, falls through to
     the unstructured path.
  2. **Unstructured** (fallback): asks the LLM for a plain-text summary with
     no schema constraints. This always produces usable output even if the
     structured parse failed, at the cost of losing typed fields.

The structured summary is converted to a human-readable text block by
``format_summary`` before being injected back into the conversation context.
"""
import json
import os

import boto3
from pydantic import BaseModel, Field, ValidationError

from common_utils import extract_json_object, get_logger
from common_utils.models import fast_model_id

MODEL_ID = fast_model_id()

bedrock = boto3.client("bedrock-runtime")
logger = get_logger(__name__)


class ConversationSummary(BaseModel):
    key_facts: list[str] = Field(description="Important facts established in the conversation")
    questions_answered: list[str] = Field(description="Questions the user asked and key points from answers")
    data_retrieved: list[str] = Field(description="Specific data or results from tool calls such as names, records, or counts")
    active_topic: str = Field(description="What the user was most recently focused on")


SUMMARY_SCHEMA = ConversationSummary.model_json_schema()

SYSTEM_PROMPT = (
    "You are a conversation summarizer for an AI assistant. "
    "Summarize the conversation into a structured JSON object that preserves all key facts, "
    "questions asked, answers given, data retrieved from tools, and the user's current focus. "
    "Be thorough but concise. Output ONLY valid JSON matching this schema:\n"
    f"{json.dumps(SUMMARY_SCHEMA, indent=2)}"
)


def summarize(conversation_text: str) -> dict:
    """Invoke the LLM to produce a structured ConversationSummary.

    Raises ``ValueError`` (no JSON object found) or ``ValidationError`` (JSON
    doesn't match the schema); the caller handles the fallback.
    """
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "messages": [
                {"role": "user", "content": f"Summarize this conversation:\n\n{conversation_text}"}
            ],
            "system": SYSTEM_PROMPT,
            "temperature": 0,
        }
    )

    response = bedrock.invoke_model(modelId=MODEL_ID, body=body, contentType="application/json")
    result = json.loads(response["body"].read())
    content = result.get("content") or []
    text = ""
    if content and isinstance(content[0], dict):
        text = (content[0].get("text") or "").strip()

    parsed = extract_json_object(text)
    summary = ConversationSummary.model_validate(parsed)
    return summary.model_dump()


def format_summary(data: dict) -> str:
    """Convert a structured summary dict into a readable multi-line text block."""
    lines = []
    if data.get("active_topic"):
        lines.append(f"Current focus: {data['active_topic']}")
    if data.get("key_facts"):
        lines.append("Key facts:")
        for fact in data["key_facts"]:
            lines.append(f"  - {fact}")
    if data.get("questions_answered"):
        lines.append("Questions answered:")
        for qa in data["questions_answered"]:
            lines.append(f"  - {qa}")
    if data.get("data_retrieved"):
        lines.append("Data retrieved:")
        for d in data["data_retrieved"]:
            lines.append(f"  - {d}")
    return "\n".join(lines)


def lambda_handler(event, context):
    """Summarize a conversation, falling back to unstructured if structured parsing fails.

    Expects ``event.conversation_text`` (the raw conversation string).

    Returns:
        200 with ``summary_data`` (structured dict or None) and ``summary_text``
        (always a string, from either the structured or fallback path).
        400 if no conversation text is provided; 500 on unrecoverable errors.
    """
    try:
        conversation_text = event.get("conversation_text", "")
        if not conversation_text:
            return {"statusCode": 400, "body": json.dumps({"error": "No conversation_text provided"})}

        summary_data = summarize(conversation_text)
        summary_text = format_summary(summary_data)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "summary_data": summary_data,
                "summary_text": summary_text,
            }),
        }
    except (ValidationError, ValueError) as err:
        # ValidationError subclasses ValueError, but name both: extract_json_object
        # raises a plain ValueError when the model returns no JSON at all.
        logger.warning("Structured summary unusable, falling back to raw summary: %s", err)
        try:
            fallback = _fallback_summarize(event.get("conversation_text", ""))
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "summary_data": None,
                    "summary_text": fallback,
                }),
            }
        except Exception:
            logger.exception("Fallback summarization also failed")
            return {"statusCode": 500, "body": json.dumps({"error": "Summarization failed"})}
    except Exception:
        logger.exception("Context summarization error")
        return {"statusCode": 500, "body": json.dumps({"error": "Summarization failed"})}


def _fallback_summarize(conversation_text: str) -> str:
    """Produce a plain-text summary without schema constraints.

    Used when the primary structured summarization fails Pydantic validation.
    Omits the system prompt and schema requirement so the LLM can return
    free-form text, which is more resilient to edge-case conversations.
    """
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Summarize this conversation concisely, preserving all key facts, "
                        "questions, answers, and data retrieved:\n\n" + conversation_text
                    ),
                }
            ],
            "temperature": 0,
        }
    )
    response = bedrock.invoke_model(modelId=MODEL_ID, body=body, contentType="application/json")
    result = json.loads(response["body"].read())
    content = result.get("content") or []
    if content and isinstance(content[0], dict):
        return (content[0].get("text") or "").strip()
    return ""
