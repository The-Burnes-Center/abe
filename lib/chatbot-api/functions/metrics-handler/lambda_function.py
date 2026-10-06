import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Attr, Key

from common_utils import DecimalJSONEncoder, get_logger, json_response, require_admin, safe_int
from common_utils.brand import brand_timezone, brand_timezone_name


DDB_TABLE_NAME = os.environ["DDB_TABLE_NAME"]
ANALYTICS_TABLE_NAME = os.environ.get("ANALYTICS_TABLE_NAME", "")

dynamodb = boto3.resource("dynamodb")
session_table = dynamodb.Table(DDB_TABLE_NAME)
analytics_table = dynamodb.Table(ANALYTICS_TABLE_NAME) if ANALYTICS_TABLE_NAME else None
logger = get_logger(__name__)

# Hours/days are shown in the deployment's brand timezone. Timestamps are stored in UTC.
LOCAL_TZ = brand_timezone()
LOCAL_TZ_NAME = brand_timezone_name()
MAX_LOOKBACK_DAYS = 365
BATCH_GET_LIMIT = 100


def parse_timestamp(timestamp_str):
    if not timestamp_str:
        return None
    try:
        if "T" in timestamp_str:
            return datetime.fromisoformat(timestamp_str.replace("Z", "+00:00").split(".")[0])
        return datetime.strptime(timestamp_str.split(".")[0], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _to_local(dt):
    """Normalize a datetime to the brand timezone. Naive timestamps are assumed UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LOCAL_TZ)


def parse_iso_date(value, fallback=None):
    if not value:
        return fallback
    try:
        return date.fromisoformat(value[:10])
    except Exception:
        return fallback


def resolve_date_range(query_params):
    """
    Resolve a (start_date, end_date) inclusive pair in local time.
    Precedence: explicit from/to > days > default 30.
    """
    today_local = datetime.now(LOCAL_TZ).date()
    from_param = query_params.get("from")
    to_param = query_params.get("to")
    if from_param or to_param:
        end = parse_iso_date(to_param, today_local) or today_local
        start = parse_iso_date(from_param, end - timedelta(days=29)) or (end - timedelta(days=29))
        if start > end:
            start, end = end, start
        span = (end - start).days + 1
        if span > MAX_LOOKBACK_DAYS:
            start = end - timedelta(days=MAX_LOOKBACK_DAYS - 1)
        return start, end

    days = safe_int(query_params.get("days"), 30, minimum=1, maximum=MAX_LOOKBACK_DAYS)
    end = today_local
    start = end - timedelta(days=days - 1)
    return start, end


def resolve_hour_window(query_params):
    """Optional hour-of-day window in local time. Returns (None, None) if not provided."""
    hf = query_params.get("hour_from")
    ht = query_params.get("hour_to")
    if hf is None and ht is None:
        return None, None
    hour_from = safe_int(hf, 0, minimum=0, maximum=23)
    hour_to = safe_int(ht, 23, minimum=0, maximum=23)
    if hour_from > hour_to:
        hour_from, hour_to = hour_to, hour_from
    return hour_from, hour_to


def iter_date_keys(start_date, end_date):
    current = start_date
    while current <= end_date:
        yield current.strftime("%Y-%m-%d")
        current += timedelta(days=1)


def _in_local_window(local, start_date, end_date, hour_from, hour_to):
    local_day = local.date()
    if start_date and local_day < start_date:
        return False
    if end_date and local_day > end_date:
        return False
    if hour_from is not None and not (hour_from <= local.hour <= hour_to):
        return False
    return True


def _item_in_local_window(item, start_date, end_date, hour_from, hour_to):
    """Filter an analytics item by local day and (optional) hour window."""
    ts = parse_timestamp(item.get("timestamp", ""))
    if ts is None:
        # Fall back to the stored date_key (UTC) if timestamp is unparseable.
        return True
    return _in_local_window(_to_local(ts), start_date, end_date, hour_from, hour_to)


def _utc_bound(day, *, pad_days):
    """UTC timestamp string for the start of a local day, padded so the string
    comparison in the scan filter never cuts off a timezone edge or a legacy
    'YYYY-MM-DD HH:MM:SS' timestamp."""
    return (day + timedelta(days=pad_days)).strftime("%Y-%m-%d")


def _scan_sessions(start_date, end_date):
    """Yield session rows with only the fields metrics need.

    Projects message_count (maintained by the session handler) instead of the
    full chat_history bodies, and narrows the scan with a time_stamp filter.
    The filter still consumes read capacity for every item, so this remains a
    full-table scan: fine for thousands of sessions, but a large deployment
    should pre-aggregate daily counts instead.
    """
    params = {"ProjectionExpression": "user_id, session_id, time_stamp, message_count"}
    if start_date and end_date:
        params["FilterExpression"] = Attr("time_stamp").between(
            _utc_bound(start_date, pad_days=-1), _utc_bound(end_date, pad_days=2)
        )
    last_evaluated_key = None
    while True:
        if last_evaluated_key:
            params["ExclusiveStartKey"] = last_evaluated_key
        response = session_table.scan(**params)
        yield from response.get("Items", [])
        last_evaluated_key = response.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break


def _legacy_message_counts(keys):
    """Count turns for sessions written before message_count existed."""
    counts = {}
    for i in range(0, len(keys), BATCH_GET_LIMIT):
        request = {
            DDB_TABLE_NAME: {
                "Keys": keys[i:i + BATCH_GET_LIMIT],
                "ProjectionExpression": "user_id, session_id, chat_history",
            }
        }
        while request:
            response = dynamodb.batch_get_item(RequestItems=request)
            for item in response.get("Responses", {}).get(DDB_TABLE_NAME, []):
                counts[(item["user_id"], item["session_id"])] = len(item.get("chat_history") or [])
            request = response.get("UnprocessedKeys") or None
    return counts


def get_user_display_map(start_date, end_date):
    """user_id -> display_name, from the analytics rows in the same range."""
    user_map = {}
    for item in fetch_analytics_items(start_date, end_date):
        uid = item.get("user_id")
        name = item.get("display_name", "")
        if uid and name and uid not in user_map:
            user_map[uid] = name
    return user_map


def summarize_session_metrics(start_date=None, end_date=None, hour_from=None, hour_to=None):
    """
    Aggregate ChatHistoryTable activity. Days, hours, and weekdays are bucketed in the
    brand timezone. start_date / end_date / hour window are optional; if omitted, all
    data is summarized.
    """
    rows = []
    legacy_keys = []
    for item in _scan_sessions(start_date, end_date):
        dt = parse_timestamp(item.get("time_stamp", ""))
        if not dt:
            continue
        local = _to_local(dt)
        if not _in_local_window(local, start_date, end_date, hour_from, hour_to):
            continue
        rows.append((item, local))
        if "message_count" not in item:
            legacy_keys.append({"user_id": item["user_id"], "session_id": item["session_id"]})

    legacy_counts = _legacy_message_counts(legacy_keys) if legacy_keys else {}
    user_display_map = get_user_display_map(start_date, end_date) if start_date and end_date else {}

    unique_users = set()
    total_messages = 0
    daily_stats = defaultdict(lambda: {"sessions": 0, "messages": 0})
    unique_users_daily = defaultdict(set)
    daily_user_sessions = defaultdict(lambda: defaultdict(int))
    daily_user_messages = defaultdict(lambda: defaultdict(int))
    hourly_counts = defaultdict(int)
    # 24 hours x 7 weekdays (Mon=0..Sun=6) message volume, used by the heatmap.
    hour_by_weekday = [[0] * 7 for _ in range(24)]
    session_msg_counts = []

    for item, local in rows:
        user_id = item.get("user_id")
        if "message_count" in item:
            message_count = int(item["message_count"])
        else:
            message_count = legacy_counts.get((user_id, item.get("session_id")), 0)
        if user_id:
            unique_users.add(user_id)
        total_messages += message_count
        session_msg_counts.append(message_count)

        date_key = local.date().strftime("%Y-%m-%d")
        daily_stats[date_key]["sessions"] += 1
        daily_stats[date_key]["messages"] += message_count
        if user_id:
            unique_users_daily[date_key].add(user_id)
            daily_user_sessions[date_key][user_id] += 1
            daily_user_messages[date_key][user_id] += message_count
        hourly_counts[local.hour] += 1
        hour_by_weekday[local.hour][local.weekday()] += message_count

    daily_breakdown = []
    for d, stats in sorted(daily_stats.items()):
        day_users = [
            {
                "user_id": uid,
                "display_name": user_display_map.get(uid) or uid,
                "sessions": daily_user_sessions[d][uid],
                "messages": daily_user_messages[d][uid],
            }
            for uid in unique_users_daily[d]
        ]
        day_users.sort(key=lambda u: u["messages"], reverse=True)
        daily_breakdown.append({
            "date": d,
            "sessions": stats["sessions"],
            "messages": stats["messages"],
            "unique_users": len(unique_users_daily[d]),
            "users": day_users,
        })

    avg_messages_per_session = (
        round(sum(session_msg_counts) / len(session_msg_counts), 1)
        if session_msg_counts
        else 0
    )
    peak_hour = max(hourly_counts, key=hourly_counts.get) if hourly_counts else None
    tz_abbrev = datetime.now(LOCAL_TZ).strftime("%Z")
    peak_hour_label = (
        f"{peak_hour:02d}:00-{peak_hour + 1:02d}:00 {tz_abbrev}" if peak_hour is not None else "N/A"
    )

    return {
        "unique_users": len(unique_users),
        "total_sessions": len(rows),
        "total_messages": total_messages,
        "daily_breakdown": daily_breakdown,
        "avg_messages_per_session": avg_messages_per_session,
        "peak_hour": peak_hour_label,
        "hourly_distribution": [
            {"hour": f"{hour:02d}:00", "sessions": hourly_counts.get(hour, 0)}
            for hour in range(24)
        ],
        # rows = hour 0..23, cols = weekday Mon..Sun
        "hour_by_weekday": hour_by_weekday,
        "timezone": LOCAL_TZ_NAME,
    }


def fetch_analytics_items(start_date, end_date, hour_from=None, hour_to=None):
    """
    Pull AnalyticsTable rows for a local date range, then filter to local day +
    optional hour window. We expand the query by one UTC day on each side because
    `date_key` is the UTC slice of the timestamp; rows on the local-day edges live
    in the neighboring UTC day.
    """
    if not analytics_table:
        return []

    items = []
    for date_key in iter_date_keys(start_date - timedelta(days=1), end_date + timedelta(days=1)):
        last_evaluated_key = None
        while True:
            query_params = {
                "IndexName": "DateIndex",
                "KeyConditionExpression": Key("date_key").eq(date_key),
            }
            if last_evaluated_key:
                query_params["ExclusiveStartKey"] = last_evaluated_key
            response = analytics_table.query(**query_params)
            items.extend(response.get("Items", []))
            last_evaluated_key = response.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break

    return [
        item for item in items
        if _item_in_local_window(item, start_date, end_date, hour_from, hour_to)
    ]


def get_faq_insights(start_date, end_date, hour_from=None, hour_to=None):
    if not analytics_table:
        return {"topics": [], "total_classified": 0}

    try:
        items = fetch_analytics_items(start_date, end_date, hour_from=hour_from, hour_to=hour_to)
        topic_counts = defaultdict(int)
        topic_samples = defaultdict(list)
        topic_seen_questions = defaultdict(set)
        total = 0

        for item in items:
            topic = item.get("topic", "Other")
            question = item.get("question", "")
            display_name = item.get("display_name", "")
            topic_counts[topic] += 1
            total += 1

            question_key = question.strip().lower()
            if not question_key or question_key in topic_seen_questions[topic] or len(topic_samples[topic]) >= 5:
                continue

            topic_seen_questions[topic].add(question_key)
            sample = {"question": question}
            if display_name:
                sample["display_name"] = display_name
            topic_samples[topic].append(sample)

        topics = sorted(
            [
                {
                    "topic": topic,
                    "count": count,
                    "sample_questions": topic_samples[topic],
                }
                for topic, count in topic_counts.items()
            ],
            key=lambda value: value["count"],
            reverse=True,
        )
        return {"topics": topics[:20], "total_classified": total}
    except Exception:
        logger.exception("Error getting FAQ insights")
        return {"topics": [], "total_classified": 0}


def get_user_breakdown(start_date, end_date, hour_from=None, hour_to=None):
    if not analytics_table:
        return {"users": [], "total_messages": 0}

    try:
        items = fetch_analytics_items(start_date, end_date, hour_from=hour_from, hour_to=hour_to)
        user_stats = defaultdict(
            lambda: {
                "messages": 0,
                "display_name": "",
                "topics": defaultdict(int),
                "questions": [],
                "seen_questions": set(),
            }
        )
        total = 0

        for item in items:
            user_id = item.get("user_id", "") or "unknown"
            display_name = item.get("display_name", "")
            topic = item.get("topic", "Other")
            question = item.get("question", "")
            timestamp = item.get("timestamp", "")

            user_stats[user_id]["messages"] += 1
            if display_name:
                user_stats[user_id]["display_name"] = display_name
            user_stats[user_id]["topics"][topic] += 1

            question_key = question.strip().lower()
            if question_key and question_key not in user_stats[user_id]["seen_questions"] and len(user_stats[user_id]["questions"]) < 10:
                user_stats[user_id]["seen_questions"].add(question_key)
                user_stats[user_id]["questions"].append(
                    {"question": question, "topic": topic, "timestamp": timestamp}
                )
            total += 1

        users = sorted(
            [
                {
                    "user_id": user_id,
                    "display_name": stats["display_name"] or user_id[:20],
                    "messages": stats["messages"],
                    "top_topics": sorted(
                        [{"topic": topic, "count": count} for topic, count in stats["topics"].items()],
                        key=lambda value: value["count"],
                        reverse=True,
                    )[:5],
                    "recent_questions": sorted(stats["questions"], key=lambda value: value["timestamp"], reverse=True),
                }
                for user_id, stats in user_stats.items()
            ],
            key=lambda value: value["messages"],
            reverse=True,
        )
        return {"users": users, "total_messages": total}
    except Exception:
        logger.exception("Error getting user breakdown")
        return {"users": [], "total_messages": 0}


def lambda_handler(event, context):
    if "OPTIONS" in event.get("routeKey", ""):
        return json_response(200, {})

    if "GET" not in event.get("routeKey", ""):
        return json_response(405, {"error": "Method Not Allowed"})

    denied = require_admin(event)
    if denied:
        return denied

    try:
        query_params = event.get("queryStringParameters") or {}
        metric_type = query_params.get("type", "overview")
        start_date, end_date = resolve_date_range(query_params)
        hour_from, hour_to = resolve_hour_window(query_params)

        range_meta = {
            "from": start_date.strftime("%Y-%m-%d"),
            "to": end_date.strftime("%Y-%m-%d"),
            "days": (end_date - start_date).days + 1,
            "hour_from": hour_from,
            "hour_to": hour_to,
            "timezone": LOCAL_TZ_NAME,
        }

        if metric_type == "faq":
            response_data = get_faq_insights(start_date, end_date, hour_from=hour_from, hour_to=hour_to)
        elif metric_type == "traffic":
            session_metrics = summarize_session_metrics(start_date, end_date, hour_from, hour_to)
            response_data = {
                "daily_breakdown": session_metrics["daily_breakdown"],
                "hourly_distribution": session_metrics["hourly_distribution"],
                "hour_by_weekday": session_metrics["hour_by_weekday"],
                "avg_messages_per_session": session_metrics["avg_messages_per_session"],
                "peak_hour": session_metrics["peak_hour"],
                "timezone": session_metrics["timezone"],
            }
        elif metric_type == "by_user":
            response_data = get_user_breakdown(start_date, end_date, hour_from=hour_from, hour_to=hour_to)
        else:
            session_metrics = summarize_session_metrics(start_date, end_date, hour_from, hour_to)
            response_data = {
                "unique_users": session_metrics["unique_users"],
                "total_sessions": session_metrics["total_sessions"],
                "total_messages": session_metrics["total_messages"],
                "daily_breakdown": session_metrics["daily_breakdown"],
                "avg_messages_per_session": session_metrics["avg_messages_per_session"],
                "peak_hour": session_metrics["peak_hour"],
                "hour_by_weekday": session_metrics["hour_by_weekday"],
                "hourly_distribution": session_metrics["hourly_distribution"],
                "timezone": session_metrics["timezone"],
            }

        response_data["range"] = range_meta
        return json_response(200, response_data, encoder=DecimalJSONEncoder)
    except Exception:
        logger.exception("Error in metrics handler")
        return json_response(500, {"message": "Failed to retrieve metrics"})
