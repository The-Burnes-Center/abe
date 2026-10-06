"""Cognito PreSignUp trigger: keeps self sign-up closed unless the email's
domain is on the deployment's allowlist.

Admin-created users (invites) always pass. Everything else (SignUp API,
external providers) is allowed only for an exact domain match against
ALLOWED_SIGNUP_DOMAINS. An empty or missing list rejects every self sign-up,
and any unexpected error rejects too (fail closed). Users are never
auto-confirmed or auto-verified: they still confirm their email.
"""
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REJECTION_MESSAGE = "Sign-up is not available for this email address."
ADMIN_CREATE_TRIGGER = "PreSignUp_AdminCreateUser"


def allowed_domains() -> set[str]:
    raw = os.environ.get("ALLOWED_SIGNUP_DOMAINS", "")
    return {d.strip().lower().lstrip("@") for d in raw.split(",") if d.strip()}


def email_domain(email: str) -> str | None:
    email = (email or "").strip().lower()
    if email.count("@") != 1:
        return None
    local, domain = email.split("@")
    if not local or not domain or "." not in domain:
        return None
    return domain


def lambda_handler(event, context):
    trigger = event.get("triggerSource", "")
    if trigger == ADMIN_CREATE_TRIGGER:
        return event

    try:
        email = ((event.get("request") or {}).get("userAttributes") or {}).get("email", "")
        domain = email_domain(email)
        is_allowed = domain is not None and domain in allowed_domains()
    except Exception:
        logger.exception("PreSignUp check failed; rejecting")
        raise Exception(REJECTION_MESSAGE)

    if not is_allowed:
        logger.warning("Rejected self sign-up (trigger=%s, domain=%s)", trigger, domain)
        raise Exception(REJECTION_MESSAGE)

    # Explicitly leave confirmation and verification to the normal email flow.
    response = event.setdefault("response", {})
    response["autoConfirmUser"] = False
    response["autoVerifyEmail"] = False
    return event
