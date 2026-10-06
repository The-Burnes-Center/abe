"""CloudFormation custom resource (cr.Provider onEvent) that creates the
OpenSearch Serverless vector index the Bedrock Knowledge Base writes to.

- Create / Update: create the index if it doesn't exist. "Already exists" is
  success; anything else fails the deployment loudly instead of letting the
  Knowledge Base be created against a missing index.
- Delete: no-op (the collection, and its indexes, are deleted with the stack).

A brand-new collection's data access policy takes a while to propagate, so
403s and connection errors are retried with backoff while time remains.
"""
import json
import logging
import os
import time

import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
from opensearchpy.exceptions import (
    AuthenticationException,
    AuthorizationException,
    ConnectionError as OpenSearchConnectionError,
    RequestError,
    TransportError,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Time for the new index to become usable before Bedrock creates the KB on it.
SETTLE_SECONDS = 60
# Keep this much of the Lambda's time budget for the settle wait plus margin.
RESERVED_MS = (SETTLE_SECONDS + 10) * 1000
INITIAL_BACKOFF_SECONDS = 2
MAX_BACKOFF_SECONDS = 15

RETRYABLE = (AuthorizationException, AuthenticationException, OpenSearchConnectionError)


def _index_body() -> dict:
    return {
        "settings": {
            "index": {
                "knn": True,
                "knn.algo_param.ef_search": 512,
            }
        },
        "mappings": {
            "properties": {
                "vector_field": {
                    "type": "knn_vector",
                    "dimension": int(os.environ["EMBEDDING_DIM"]),
                    "method": {
                        "name": "hnsw",
                        "space_type": "innerproduct",
                        "engine": "faiss",
                        "parameters": {"ef_construction": 512, "m": 16},
                    },
                },
                "metadata_field": {"type": "text", "index": False},
                "text_field": {"type": "text"},
            }
        },
    }


def _client() -> OpenSearch:
    region = os.environ.get("REGION") or os.environ["AWS_REGION"]
    credentials = boto3.Session().get_credentials()
    return OpenSearch(
        hosts=[{"host": os.environ["COLLECTION_ENDPOINT"], "port": 443}],
        http_auth=AWSV4SignerAuth(credentials, region, "aoss"),
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        pool_maxsize=20,
        timeout=30,
    )


def _is_already_exists(error: Exception) -> bool:
    return isinstance(error, RequestError) and "resource_already_exists_exception" in str(error.error)


def _remaining_ms(context) -> int:
    if context is None or not hasattr(context, "get_remaining_time_in_millis"):
        return 10 * 60 * 1000
    return context.get_remaining_time_in_millis()


def create_index_if_missing(client: OpenSearch, index_name: str, context) -> bool:
    """Create the index; return True if created, False if it already existed."""
    backoff = INITIAL_BACKOFF_SECONDS
    attempt = 0
    while True:
        attempt += 1
        try:
            client.indices.create(index=index_name, body=json.dumps(_index_body()))
            logger.info("Created index %s on attempt %d", index_name, attempt)
            return True
        except RequestError as e:
            if _is_already_exists(e):
                logger.info("Index %s already exists", index_name)
                return False
            raise
        except RETRYABLE as e:
            if _remaining_ms(context) - backoff * 1000 <= RESERVED_MS:
                logger.error("Giving up creating index %s after %d attempts: %s", index_name, attempt, e)
                raise
            logger.warning(
                "Index create attempt %d failed (%s); retrying in %ss (access policy may still be propagating)",
                attempt, type(e).__name__, backoff,
            )
            time.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)


def lambda_handler(event, context):
    request_type = event.get("RequestType", "Create")
    index_name = os.environ["INDEX_NAME"]
    logger.info("%s request for index %s on %s", request_type, index_name, os.environ.get("COLLECTION_ENDPOINT"))

    if request_type == "Delete":
        return {"PhysicalResourceId": event.get("PhysicalResourceId") or index_name}

    if request_type not in ("Create", "Update"):
        raise ValueError(f"Unsupported RequestType: {request_type}")

    try:
        created = create_index_if_missing(_client(), index_name, context)
    except TransportError as e:
        # Surface the status and OpenSearch error type in the CloudFormation event.
        raise RuntimeError(f"Failed to create index {index_name}: HTTP {e.status_code} {e.error}") from e
    if created:
        time.sleep(SETTLE_SECONDS)
    return {"PhysicalResourceId": index_name, "Data": {"IndexName": index_name, "Created": str(created).lower()}}
