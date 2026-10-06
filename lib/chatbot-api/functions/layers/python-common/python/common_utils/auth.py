import json
import os

from .responses import json_response
from .validation import truncate_text

ADMIN_GROUP_NAME = os.environ.get("ADMIN_GROUP_NAME", "Admin")
FORBIDDEN_MESSAGE = "You do not have permission to perform this action."


def get_claims(event: dict | None) -> dict:
    # Each level can be present but null (e.g. "authorizer": None).
    request_context = (event or {}).get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}
    jwt = authorizer.get("jwt") or {}
    return jwt.get("claims") or {}


def _parse_groups(raw) -> list[str]:
    """Normalize every encoding API Gateway uses for the `cognito:groups` claim.

    The HTTP API JWT authorizer flattens array claims inconsistently, so the
    same token can arrive as a real list, a JSON string '["Admin","X"]', a
    bracketed string "[Admin X]" / "[Admin, X]", or a bare string "Admin".
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(g).strip() for g in raw if str(g).strip()]
    text = str(raw).strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(g).strip() for g in parsed if str(g).strip()]
        except (TypeError, ValueError):
            pass
        text = text.strip("[]")
    tokens = text.replace(",", " ").split()
    return [t.strip().strip('"').strip("'") for t in tokens if t.strip().strip('"').strip("'")]


def get_groups(event: dict | None) -> list[str]:
    return _parse_groups(get_claims(event).get("cognito:groups"))


def is_admin(event: dict | None) -> bool:
    # Exact group membership only. A substring match would let group names like
    # `AdminViewer` or `NotAdmin` slip through the admin gate.
    return ADMIN_GROUP_NAME in get_groups(event)


def require_admin(event: dict | None) -> dict | None:
    """Return a 403 response for non-admins, or None when the caller is an admin.

    Usage: `if (denied := require_admin(event)): return denied`
    """
    if is_admin(event):
        return None
    return json_response(403, {"error": FORBIDDEN_MESSAGE})


def get_audit_actor_label(event: dict | None, *, max_length: int = 200) -> str:
    """Human-readable actor for audit logs: prefers name from JWT, then email or username."""
    claims = get_claims(event)
    for key in ("name", "email", "cognito:username", "username"):
        value = str(claims.get(key) or "").strip()
        if value:
            return truncate_text(value, max_length)
    return "Admin"
