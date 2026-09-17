import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException

from app.database import get_connection, get_transaction

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12
# Window a user has, after a correct password but before a completed OTP
# check, to submit/resend an OTP. Independent of OTP_EXPIRE_MINUTES in
# routes/auth.py (the OTP code's own, shorter expiry) — this just bounds how
# long the "pending" login session itself stays valid across resends.
OTP_PENDING_TOKEN_EXPIRE_MINUTES = 15

PASSWORD_MIN_LENGTH = 8
PASSWORD_POLICY_HINT = (
    f"Password must be at least {PASSWORD_MIN_LENGTH} characters and include "
    "a letter, a number, and a special character"
)


def validate_password_strength(password: str) -> str | None:
    """Every password-setting entry point (partner/partner-user creation,
    self-service change password, invite/reset-link bootstrap) shares this
    one policy check, so strengthening it in one place covers all of them.
    Returns the specific unmet requirement, or None if `password` is fine."""
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters"
    if not re.search(r"[A-Za-z]", password):
        return "Password must include at least one letter"
    if not re.search(r"\d", password):
        return "Password must include at least one number"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Password must include at least one special character"
    return None


def _secret_key() -> str:
    secret = os.getenv("SECRET_KEY")
    if not secret:
        raise RuntimeError("SECRET_KEY is not configured")
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        # hashed value isn't a valid bcrypt hash (e.g. legacy plaintext / "pending_invite")
        return False


def create_access_token(user_id: str, token_version: int = 0) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # `tv` must match users.token_version on every request — logout and
    # password changes bump the column so a captured Bearer token cannot be
    # replayed after the session is ended server-side.
    payload = {"sub": str(user_id), "exp": expires_at, "tv": int(token_version)}
    return jwt.encode(payload, _secret_key(), algorithm=ALGORITHM)


def create_otp_pending_token(user_id: str) -> str:
    """Issued once a login's email/password check succeeds for a
    2FA-enabled user, in place of a real access token. Carries a "purpose"
    claim (a normal access token never has one) so _decode_token below
    refuses it at every protected endpoint — it is only ever accepted by
    verify-otp/resend-otp, which call decode_otp_pending_token instead."""
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_PENDING_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires_at, "purpose": "otp_pending"}
    return jwt.encode(payload, _secret_key(), algorithm=ALGORITHM)


def _decode_payload(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, _secret_key(), algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")


def _decode_token(token: str) -> str:
    payload = _decode_payload(token)
    if payload.get("purpose"):
        # An otp_pending token (or any future non-default-purpose token)
        # must never authenticate a real request.
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    return payload["sub"]


def _decode_access_token(token: str) -> tuple[str, int]:
    """Returns (user_id, token_version). Missing `tv` is treated as 0 so
    tokens issued before this claim existed still work until the next logout
    bumps users.token_version above 0."""
    payload = _decode_payload(token)
    if payload.get("purpose"):
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    try:
        token_version = int(payload.get("tv", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    return str(user_id), token_version


def decode_otp_pending_token(token: str) -> str:
    payload = _decode_payload(token)
    if payload.get("purpose") != "otp_pending":
        raise HTTPException(status_code=401, detail="Invalid or expired OTP session, please log in again")
    return payload["sub"]


def revoke_user_sessions(user_id: Any) -> None:
    """Invalidate every outstanding access token for this user by bumping
    token_version. Called on logout and whenever credentials change."""
    with get_transaction() as connection:
        connection.execute(
            "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = %s",
            (user_id,),
        )


def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Resolves the JWT to an active user, regardless of role. Role-specific
    dependencies (get_current_admin, get_current_partner) build on this."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.removeprefix("Bearer ").strip()
    user_id, token_version = _decode_access_token(token)

    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT id, email, full_name, role, is_active,
                   COALESCE(token_version, 0) AS token_version
            FROM users
            WHERE id = %s
            """,
            (user_id,),
        ).fetchone()

    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Account is inactive or no longer exists")

    if int(user["token_version"]) != token_version:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")

    return user


def get_current_admin(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Gates every B2B super-admin route. Both 'admin' (Super Admin portal,
    B2B-only) and 'platform_admin' (Admin Portal, B2B + B2C) are full B2B
    administrators — platform_admin additionally gets the full B2C admin
    module via get_current_platform_admin below. 'admin' also reuses this
    same dependency directly on the B2C Orders/Reports routes
    (app/b2c_admin/routes/admin_orders.py, admin_reports.py) — the one slice
    of B2C admin Super Admin gets; the rest stays platform_admin-only."""
    if current_user["role"] not in ("admin", "platform_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def get_current_platform_admin(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Gates most B2C admin routes (Admin Portal only) — deliberately
    stricter than get_current_admin: Super Admin ('admin') does not get this
    access, except for Orders/Reports which use get_current_admin directly
    instead of this dependency (see admin_orders.py, admin_reports.py)."""
    if current_user["role"] != "platform_admin":
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return current_user


def get_current_partner(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """A Partner Panel login (Dealer-onboarded, full org-level access). Linked
    via organization_users (role='partner') rather than the legacy
    organizations.portal_user_id column, since more than one user can hold
    this access for the same organization — see
    organizations.create_or_link_organization_user."""
    if current_user["role"] != "partner":
        raise HTTPException(status_code=403, detail="Partner access required")

    with get_connection() as connection:
        organization = connection.execute(
            """
            SELECT o.id, o.organization_name, o.organization_type, o.payment_mode
            FROM organization_users ou
            JOIN organizations o ON o.id = ou.organization_id
            WHERE ou.user_id = %s AND ou.is_active = true AND o.is_active = true
            ORDER BY ou.created_at ASC
            LIMIT 1
            """,
            (current_user["id"],),
        ).fetchone()

    if not organization:
        raise HTTPException(status_code=403, detail="No partner organization linked to this account")

    return {
        **current_user,
        "organization_id": organization["id"],
        "organization_name": organization["organization_name"],
        "organization_type": organization["organization_type"],
        "payment_mode": organization["payment_mode"],
    }


def get_current_partner_user(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """A Partner User (Cyber Shop / associate) — an organization_users member,
    as opposed to the Partner (organization) login itself. organization_id AND
    organization_user_id are both derived here from the authenticated user_id,
    never accepted from the client — every partner-user route depends on this
    instead of trusting request params.

    A single global login identity can be linked to more than one
    organization (see partner.create_partner_user's cross-org link flow), so
    this resolves to their oldest active membership — the practical common
    case is exactly one."""
    if current_user["role"] != "member":
        raise HTTPException(status_code=403, detail="Partner user access required")

    with get_connection() as connection:
        membership = connection.execute(
            """
            SELECT ou.id AS organization_user_id, ou.organization_id, o.organization_name, o.organization_type
            FROM organization_users ou
            JOIN organizations o ON o.id = ou.organization_id
            WHERE ou.user_id = %s AND ou.is_active = true AND o.is_active = true
            ORDER BY ou.created_at ASC
            LIMIT 1
            """,
            (current_user["id"],),
        ).fetchone()

    if not membership:
        raise HTTPException(status_code=403, detail="No active partner organization membership for this account")

    return {
        **current_user,
        "organization_user_id": membership["organization_user_id"],
        "organization_id": membership["organization_id"],
        "organization_name": membership["organization_name"],
        "organization_type": membership["organization_type"],
    }


def get_current_partner_or_member(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Some views (e.g. the notifications bell) make sense for either
    partner-side login and only need organization_id out of it — this
    accepts a Partner Panel login (get_current_partner) or a Partner User
    login (get_current_partner_user) and normalizes to whichever one
    applies, instead of forcing every such route to special-case both roles
    itself. Both dependency functions below take current_user as a plain
    argument here rather than through their own Depends resolution, which
    works fine since they're just ordinary functions underneath."""
    if current_user["role"] == "partner":
        return get_current_partner(current_user)
    if current_user["role"] == "member":
        return get_current_partner_user(current_user)
    raise HTTPException(status_code=403, detail="Partner access required")
