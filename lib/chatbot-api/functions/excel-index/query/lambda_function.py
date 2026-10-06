"""
Excel Index Query Lambda -- generic DynamoDB-backed query engine for Excel indexes.

Reads from a shared DynamoDB table where each Excel index is stored under a
partition key (pk = index_id). Supports three actions:

  - **status**  -- return index health (row count, last update, error state)
  - **preview** -- return the first N rows for UI table previews
  - **query**   -- full-featured filtering, aggregation, sorting, and pagination

All filtering happens in-memory after a full partition scan. This is acceptable
because individual indexes are typically small (hundreds to low-thousands of
rows), but it means query latency scales linearly with partition size. DynamoDB
Query pagination is followed to completion so that aggregate totals (counts,
distinct values, min/max) are accurate across the entire dataset.

Fuzzy matching:
    Text filters use ``_norm()`` which strips all punctuation and collapses
    whitespace before comparing. This handles real-world name variations
    like "ABC, LLC." vs "ABC LLC" or "O'Brien" vs "OBrien" without requiring
    exact formatting from the caller.

Sort and min/max ordering:
    ``_typed`` classifies each cell as a number, date or text. Sorting uses
    ``(kind rank, value)`` tuples (numbers, then dates, then text) and min/max
    (``_Extreme``) compare only values of the same kind, so mixed columns never
    raise TypeError and "10" is greater than "9".
"""
import json
import os
import re
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from pydantic import ValidationError

from common_utils import get_logger
from common_utils.dates import parse_date_like
from models import QueryIndexRequest, StatusResponse, PreviewResponse

DDB = boto3.resource("dynamodb")
TABLE_NAME = os.environ["TABLE_NAME"]
SK_META = "META"

SKIP_FIELDS = {"pk", "sk"}
_PUNCT_RE = re.compile(r'[^\w\s]')
_MULTI_WS = re.compile(r'\s+')


def lambda_handler(event, context):
    """Entry point for API Gateway / direct invocation.

    Validates the incoming request with Pydantic, dispatches to the appropriate
    action handler (status / preview / query), and returns a JSON response.
    """
    body = _get_payload(event)
    try:
        req = QueryIndexRequest.model_validate(body)
    except ValidationError as e:
        return _response(400, {"error": "Invalid request", "details": e.errors()})

    pk = req.index_name
    try:
        if req.action == "status":
            out = _do_status(pk)
        elif req.action == "preview":
            out = _do_preview(pk, req.preview_rows)
        else:
            out = _do_query(
                pk=pk,
                free_text=req.free_text,
                filters=req.filters,
                date_before=req.date_before,
                date_after=req.date_after,
                count_only=req.count_only,
                count_unique=req.count_unique,
                group_by=req.group_by,
                group_by_value_max=req.group_by_value_max,
                distinct_values=req.distinct_values,
                min_value=req.min_value,
                max_value=req.max_value,
                sort_by=req.sort_by,
                sort_order=req.sort_order,
                columns=req.columns,
                limit=req.limit,
                offset=req.offset,
            )
        return _response(200, out)
    except ValueError as e:
        # Argument problems (e.g. group_by_value_max without group_by) are
        # safe and useful for the model to see so it can correct the call.
        return _response(400, {"error": str(e)})
    except Exception:
        get_logger(__name__).exception("Excel index query failed for %s", pk)
        return _response(500, {"error": "The index query failed. Please try again."})


def _get_payload(event: dict) -> dict:
    """Extract the request body from an API Gateway proxy event or a direct invoke."""
    if "body" in event and isinstance(event["body"], str):
        return json.loads(event["body"]) if event["body"] else {}
    if "action" in event:
        return event
    return event.get("body") or event


def _response(status: int, body: dict | list) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def _item_to_row(item: dict) -> dict[str, Any]:
    """Convert a DynamoDB item to a user-facing row by stripping internal keys (pk, sk)."""
    return {k: v for k, v in item.items() if k not in SKIP_FIELDS}


def _do_status(pk: str) -> dict:
    """Return the current status of an index by reading its META item.

    Status is derived from the stored ``status`` field when present, otherwise
    inferred from the presence of an error message or a positive row count.
    """
    table = DDB.Table(TABLE_NAME)
    try:
        resp = table.get_item(Key={"pk": pk, "sk": SK_META})
    except Exception as e:
        raise RuntimeError(f"DynamoDB get failed: {e}") from e
    item = resp.get("Item")
    if not item:
        return StatusResponse(
            status="NO_DATA", has_data=False, row_count=0,
            last_updated=None, error_message=None,
        ).model_dump()
    row_count = int(item.get("row_count", 0))
    stored_status = item.get("status")
    if stored_status in ("PROCESSING", "COMPLETE", "ERROR"):
        status = stored_status
    elif item.get("error"):
        status = "ERROR"
    elif row_count > 0:
        status = "COMPLETE"
    else:
        status = "PROCESSING"
    return StatusResponse(
        status=status,
        has_data=row_count > 0,
        row_count=row_count,
        last_updated=item.get("last_updated"),
        error_message=item.get("error"),
    ).model_dump()


def _do_preview(pk: str, n: int) -> dict:
    """Return the first *n* data rows and the column list for UI table rendering.

    Column order comes from the META item (set during parsing) so the preview
    matches the original Excel column order even though DynamoDB items are unordered.
    """
    table = DDB.Table(TABLE_NAME)
    meta = table.get_item(Key={"pk": pk, "sk": SK_META}).get("Item", {})
    stored_columns = meta.get("columns", [])

    resp = table.query(
        KeyConditionExpression=Key("pk").eq(pk),
        Limit=max(n + 10, 50),
    )
    items = resp.get("Items", [])
    items = [it for it in items if it.get("sk") != SK_META]
    rows = [_item_to_row(it) for it in items][:n]
    if not rows:
        return PreviewResponse(columns=[], rows=[]).model_dump()
    columns = stored_columns if stored_columns else list(rows[0].keys())
    return PreviewResponse(columns=columns, rows=rows).model_dump()


def _norm(s: str) -> str:
    """Strip punctuation and collapse whitespace for fuzzy substring matching."""
    return _MULTI_WS.sub(' ', _PUNCT_RE.sub('', s)).strip().lower()


def _contains(haystack: str, needle: str) -> bool:
    """Case-insensitive, punctuation-insensitive substring check."""
    return _norm(needle) in _norm(haystack)


# Date parsing lives in the shared layer (common_utils.dates) so the parser's
# date-column inference and this engine's filtering use the same formats.
_parse_date = parse_date_like


def _row_matches(
    row: dict[str, Any],
    free_text: str | None,
    filters: dict[str, Any] | None,
    date_before: dict[str, str] | None = None,
    date_after: dict[str, str] | None = None,
) -> bool:
    """Test whether a single row passes all filter criteria.

    Applies (in order, short-circuiting on first failure):
      1. free_text -- fuzzy substring match across all non-key columns
      2. filters   -- per-column fuzzy substring matches (AND logic)
      3. date_before / date_after -- parsed date range comparisons
    """
    if free_text:
        if not any(
            _contains(str(v), free_text)
            for k, v in row.items()
            if k not in SKIP_FIELDS
        ):
            return False
    if filters:
        for col, value in filters.items():
            cell = str(row.get(col) or "")
            if not _contains(cell, str(value)):
                return False
    if date_before:
        for col, threshold_str in date_before.items():
            threshold = _parse_date(threshold_str)
            cell_date = _parse_date(str(row.get(col) or ""))
            if threshold is None:
                continue
            if cell_date is None or cell_date >= threshold:
                return False
    if date_after:
        for col, threshold_str in date_after.items():
            threshold = _parse_date(threshold_str)
            cell_date = _parse_date(str(row.get(col) or ""))
            if threshold is None:
                continue
            if cell_date is None or cell_date <= threshold:
                return False
    return True


def _project_row(row: dict[str, Any], columns: list[str] | None) -> dict[str, Any]:
    """Return only the requested columns from a row, or all columns if None."""
    if columns is None:
        return row
    cols_set = set(columns)
    return {k: v for k, v in row.items() if k in cols_set}


# Rank used when sorting a column that mixes kinds: numbers, then dates, then
# text. Values are only ever compared with values of the same kind, so a column
# holding both dates and numbers can't raise TypeError.
_KIND_RANK = {"number": 0, "date": 1, "text": 2}


def _typed(cell: Any) -> tuple[str, Any] | None:
    """Classify a cell as ("date", date), ("number", float) or ("text", str).

    Numbers tolerate thousands separators and a leading currency sign, so
    "$1,200" compares as 1200 rather than as the string "$1,200" (which used
    to make "9" the max of a column holding 9 and 10).
    """
    if cell is None:
        return None
    s = str(cell).strip()
    if not s:
        return None
    d = _parse_date(s)
    if d is not None:
        return ("date", d)
    try:
        return ("number", float(s.replace(",", "").lstrip("$")))
    except ValueError:
        return ("text", s.lower())


class _Extreme:
    """Running min or max of a column, compared by kind.

    Tracks the best value per kind and reports the one from the column's
    dominant non-text kind (numbers win ties), falling back to text only when
    the column has no numbers or dates. The original cell text is returned.
    """

    def __init__(self, want_max: bool):
        self.want_max = want_max
        self.best: dict[str, tuple[Any, str]] = {}
        self.counts: dict[str, int] = {}

    def add(self, cell: Any) -> None:
        typed = _typed(cell)
        if typed is None:
            return
        kind, value = typed
        self.counts[kind] = self.counts.get(kind, 0) + 1
        current = self.best.get(kind)
        if current is None or (value > current[0] if self.want_max else value < current[0]):
            self.best[kind] = (value, str(cell).strip())

    def result(self) -> str | None:
        if not self.best:
            return None
        typed_kinds = [k for k in ("number", "date") if k in self.best]
        if typed_kinds:
            kind = max(typed_kinds, key=lambda k: (self.counts[k], k == "number"))
        else:
            kind = "text"
        return self.best[kind][1]


def _do_query(
    pk: str,
    free_text: str | None = None,
    filters: dict[str, Any] | None = None,
    date_before: dict[str, str] | None = None,
    date_after: dict[str, str] | None = None,
    count_only: bool = False,
    count_unique: str | None = None,
    group_by: str | None = None,
    group_by_value_max: str | None = None,
    distinct_values: str | None = None,
    min_value: str | None = None,
    max_value: str | None = None,
    sort_by: str | None = None,
    sort_order: str = "asc",
    columns: list[str] | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Execute a filtered query against the full index partition.

    Performs a DynamoDB Query (not Scan) scoped to the partition key, then
    applies all filters in-memory. All pages are consumed so that aggregate
    values (count, distinct, min, max, group_by) reflect the complete dataset.

    Performance note: every call reads the entire partition. This is acceptable
    for typical Excel indexes (hundreds to low-thousands of rows) but would need
    server-side filtering or a secondary index strategy for very large datasets.

    The ``sort_by`` key function uses ``(priority, value)`` tuples so that dates
    and numbers (priority 0) sort before plain strings (priority 1), avoiding
    mixed-type comparison errors.
    """
    if group_by_value_max and not group_by:
        raise ValueError("group_by_value_max requires group_by")
    table = DDB.Table(TABLE_NAME)
    all_matched: list[dict] = []
    total = 0
    unique_vals: set[str] = set() if count_unique else None
    group_counts: dict[str, int] = {} if group_by else None
    group_max: dict[str, _Extreme] = {}
    distinct_set: set[str] = set() if distinct_values else None
    min_tracker = _Extreme(want_max=False) if min_value is not None else None
    max_tracker = _Extreme(want_max=True) if max_value is not None else None

    scan_kw: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(pk),
    }
    while True:
        resp = table.query(**scan_kw)
        for item in resp.get("Items", []):
            if item.get("sk") == SK_META:
                continue
            row = _item_to_row(item)
            if _row_matches(row, free_text=free_text, filters=filters,
                            date_before=date_before, date_after=date_after):
                total += 1
                if unique_vals is not None:
                    val = str(row.get(count_unique) or "").strip()
                    if val:
                        unique_vals.add(val)
                if group_counts is not None:
                    gval = str(row.get(group_by) or "").strip() or "(empty)"
                    group_counts[gval] = group_counts.get(gval, 0) + 1
                    if group_by_value_max:
                        group_max.setdefault(gval, _Extreme(want_max=True)).add(row.get(group_by_value_max))
                if distinct_set is not None:
                    dval = str(row.get(distinct_values) or "").strip()
                    if dval:
                        distinct_set.add(dval)
                if min_tracker is not None:
                    min_tracker.add(row.get(min_value))
                if max_tracker is not None:
                    max_tracker.add(row.get(max_value))
                if not count_only:
                    all_matched.append(row)
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kw["ExclusiveStartKey"] = last_key  # pagination works identically for query()

    if sort_by and not count_only and all_matched:
        def _sort_key(r: dict) -> Any:
            typed = _typed(r.get(sort_by)) or ("text", "")
            return (_KIND_RANK[typed[0]], typed[1])
        all_matched.sort(key=_sort_key, reverse=(sort_order == "desc"))

    collected = []
    if not count_only:
        page = all_matched[offset:offset + limit]
        collected = [_project_row(r, columns) for r in page]

    result: dict[str, Any] = {
        "rows": collected,
        "total_matches": total,
        "returned": len(collected),
        "offset": offset,
    }
    if unique_vals is not None:
        result["unique_count"] = len(unique_vals)
        result["unique_column"] = count_unique
    if group_counts is not None:
        result["group_by"] = group_by
        result["groups"] = dict(sorted(group_counts.items()))
    group_max_display = {g: t.result() for g, t in group_max.items() if t.result() is not None}
    if group_by_value_max and group_max_display:
        result["group_by_value_max_column"] = group_by_value_max
        result["group_max_values"] = dict(sorted(group_max_display.items()))
    if distinct_set is not None:
        result["distinct_values"] = sorted(distinct_set)
        result["distinct_column"] = distinct_values
        result["distinct_count"] = len(distinct_set)
    min_display = min_tracker.result() if min_tracker else None
    max_display = max_tracker.result() if max_tracker else None
    if min_display is not None:
        result["min"] = {"column": min_value, "value": min_display}
    if max_display is not None:
        result["max"] = {"column": max_value, "value": max_display}
    return result
