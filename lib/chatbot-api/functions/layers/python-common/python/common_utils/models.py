"""Bedrock model ID defaults shared by the Python Lambdas.

CDK passes PRIMARY_MODEL_ID / FAST_MODEL_ID to every Lambda that calls Bedrock;
these fallbacks only apply when a Lambda is run without them (tests, manual
console invocations). They mirror the CDK defaults: Opus 4.6 primary, Sonnet
4.6 fast, with the cross-region inference-profile prefix for the Lambda's region.
"""
import os

_PRIMARY_MODEL = "anthropic.claude-opus-4-6-v1"
_FAST_MODEL = "anthropic.claude-sonnet-4-6"

_GEO_PREFIXES = (("us-", "us"), ("eu-", "eu"), ("ap-", "apac"))


def _geo_prefix(region: str | None = None) -> str:
    region = (region or os.environ.get("AWS_REGION") or "").lower()
    for region_start, prefix in _GEO_PREFIXES:
        if region.startswith(region_start):
            return prefix
    return "us"


def default_model_id(kind: str = "fast", region: str | None = None) -> str:
    model = _PRIMARY_MODEL if kind == "primary" else _FAST_MODEL
    return f"{_geo_prefix(region)}.{model}"


def fast_model_id() -> str:
    return os.environ.get("FAST_MODEL_ID") or default_model_id("fast")


def primary_model_id() -> str:
    return os.environ.get("PRIMARY_MODEL_ID") or default_model_id("primary")
