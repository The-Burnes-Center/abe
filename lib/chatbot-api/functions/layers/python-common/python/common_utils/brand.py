"""Brand values injected by CDK from config/brand.ts (with neutral fallbacks)."""
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "America/New_York"


def assistant_name() -> str:
    return os.environ.get("ASSISTANT_NAME") or "ABE"


def organization_name() -> str:
    return os.environ.get("ORGANIZATION_NAME") or "AI for Impact"


def brand_timezone_name() -> str:
    """IANA timezone for the deployment; invalid values fall back to the default."""
    name = os.environ.get("BRAND_TIMEZONE") or DEFAULT_TIMEZONE
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError):
        return DEFAULT_TIMEZONE


def brand_timezone() -> ZoneInfo:
    return ZoneInfo(brand_timezone_name())
