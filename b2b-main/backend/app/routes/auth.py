import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, field_validator

from app.auth import (
    create_access_token,
    create_otp_pending_token,
    decode_otp_pending_token,
    get_current_admin,
    get_current_user,
    hash_password,
    revoke_user_sessions,
    validate_password_strength,
    verify_password,
)
from app.database import get_connection, get_transaction
from app.email_service import send_otp_email

router = APIRouter()

# How long an emailed OTP itself stays valid. The otp_pending token that
# gates verify/resend (auth.OTP_PENDING_TOKEN_EXPIRE_MINUTES) is deliberately
# longer, so a resend can issue a fresh OTP_EXPIRE_MINUTES window without the
# pending session itself having timed out first.
OTP_EXPIRE_MINUTES = 5
OTP_MAX_ATTEMPTS = 5


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class VerifyOtpPayload(BaseModel):
    otp_token: str
    otp: str

    @field_validator("otp")
    @classmethod
    def _validate_otp(cls, value: str) -> str:
        if not value.isdigit() or len(value) != 6:
            raise ValueError("OTP must be a 6-digit code")
        return value


class ResendOtpPayload(BaseModel):
    otp_token: str


class SetPasswordPayload(BaseModel):
    token: str
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


class TestMailPayload(BaseModel):
    to_email: str


def _partner_org_fields(user_id: Any) -> dict[str, Any]:
    """organization_name/type/payment_mode for a partner-role user, or {} if
    none linked. See auth.get_current_partner for the same
    organization_users-based resolution (role='partner' can now be linked to
    more than one user per organization, so this is no longer keyed off
    organizations.portal_user_id)."""
    with get_connection() as connection:
        organization = connection.execute(
            """
            SELECT o.organization_name, o.organization_type, o.payment_mode
            FROM organization_users ou
            JOIN organizations o ON o.id = ou.organization_id
            WHERE ou.user_id = %s AND ou.is_active = true AND o.is_active = true
            ORDER BY ou.created_at ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    if not organization:
        return {}
    return {
        "organization_name": organization["organization_name"],
        "organization_type": organization["organization_type"],
        "payment_mode": organization["payment_mode"],
    }


def _partner_user_org_fields(user_id: Any) -> dict[str, Any]:
    """organization_id/name for a member-role (Partner User) login, or {} if
    they have no active membership. See auth.get_current_partner_user for the
    same "oldest active membership" resolution used on every other request."""
    with get_connection() as connection:
        membership = connection.execute(
            """
            SELECT ou.id AS organization_user_id, ou.organization_id, o.organization_name
            FROM organization_users ou
            JOIN organizations o ON o.id = ou.organization_id
            WHERE ou.user_id = %s AND ou.is_active = true AND o.is_active = true
            ORDER BY ou.created_at ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    if not membership:
        return {}
    return {
        "organization_user_id": membership["organization_user_id"],
        "organization_id": membership["organization_id"],
        "organization_name": membership["organization_name"],
    }


def _issue_session(user: dict[str, Any]) -> dict[str, Any]:
    """Builds the real, authenticated login response — shared by the
    no-2FA path in login() and by verify_otp() once a 2FA-enabled user's
    code has been confirmed. Role-agnostic: whichever user type gets 2FA
    next (see routes/organizations.py's two_factor_enabled field) lands
    here the same way, no per-role branching needed above this point."""
    token_version = int(user.get("token_version") or 0)
    token = create_access_token(user["id"], token_version=token_version)
    user_out = {"id": user["id"], "email": user["email"], "full_name": user["full_name"], "role": user["role"]}
    if user["role"] == "partner":
        org_fields = _partner_org_fields(user["id"])
        if not org_fields:
            raise HTTPException(status_code=403, detail="No partner organization linked to this account")
        user_out.update(org_fields)
    elif user["role"] == "member":
        org_fields = _partner_user_org_fields(user["id"])
        if not org_fields:
            raise HTTPException(status_code=403, detail="No active partner organization membership for this account")
        user_out.update(org_fields)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user_out,
    }


def _generate_and_send_otp(connection, user: dict[str, Any]) -> None:
    """Generates a fresh 6-digit OTP, stores its hash (bcrypt, same as
    password_hash) + expiry on the user's row, resets the attempt counter,
    and emails it. Used by both the initial login OTP send and resend-otp —
    a resend fully replaces the previous code rather than extending it, so
    an old, possibly-intercepted code stops working the moment a new one is
    requested."""
    otp_code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES)
    connection.execute(
        """
        UPDATE users
        SET otp_code_hash = %s, otp_expires_at = %s, otp_attempts = 0
        WHERE id = %s
        """,
        (hash_password(otp_code), expires_at, user["id"]),
    )
    try:
        send_otp_email(
            to_email=user["email"],
            full_name=user["full_name"] or "",
            otp_code=otp_code,
            expires_in_minutes=OTP_EXPIRE_MINUTES,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send OTP email: {e}")


@router.post("/login")
def login(payload: LoginPayload) -> dict[str, Any]:
    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT id, email, full_name, role, is_active, password_hash, two_factor_enabled,
                   COALESCE(token_version, 0) AS token_version
            FROM users
            WHERE lower(email) = lower(%s)
            """,
            (payload.email,),
        ).fetchone()

    invalid_credentials = HTTPException(status_code=401, detail="Invalid email or password")

    if not user or not user["is_active"]:
        raise invalid_credentials
    if user["role"] not in ("admin", "partner", "member", "platform_admin"):
        raise HTTPException(status_code=403, detail="This account does not have portal access")
    if user["password_hash"] == "pending_invite" or not verify_password(payload.password, user["password_hash"]):
        raise invalid_credentials

    if user["two_factor_enabled"]:
        with get_transaction() as connection:
            _generate_and_send_otp(connection, user)
        return {
            "otp_required": True,
            "otp_token": create_otp_pending_token(user["id"]),
            "email": user["email"],
            "expires_in": OTP_EXPIRE_MINUTES * 60,
        }

    return _issue_session(user)


@router.post("/verify-otp")
def verify_otp(payload: VerifyOtpPayload) -> dict[str, Any]:
    user_id = decode_otp_pending_token(payload.otp_token)

    with get_transaction() as connection:
        user = connection.execute(
            """
            SELECT id, email, full_name, role, is_active, otp_code_hash, otp_expires_at, otp_attempts,
                   COALESCE(token_version, 0) AS token_version
            FROM users
            WHERE id = %s
            """,
            (user_id,),
        ).fetchone()

        if not user or not user["is_active"]:
            raise HTTPException(status_code=401, detail="Account is inactive or no longer exists")
        if not user["otp_code_hash"] or not user["otp_expires_at"]:
            raise HTTPException(status_code=400, detail="No OTP is pending for this account. Please log in again.")
        if user["otp_expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This OTP has expired. Please resend a new code.")
        if user["otp_attempts"] >= OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=400, detail="Too many incorrect attempts. Please resend a new code.")
        if not verify_password(payload.otp, user["otp_code_hash"]):
            connection.execute("UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = %s", (user["id"],))
            raise HTTPException(status_code=400, detail="Invalid OTP. Please try again.")

        connection.execute(
            "UPDATE users SET otp_code_hash = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = %s",
            (user["id"],),
        )

    return _issue_session(user)


@router.post("/resend-otp")
def resend_otp(payload: ResendOtpPayload) -> dict[str, Any]:
    user_id = decode_otp_pending_token(payload.otp_token)

    with get_transaction() as connection:
        user = connection.execute(
            "SELECT id, email, full_name, is_active FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()
        if not user or not user["is_active"]:
            raise HTTPException(status_code=401, detail="Account is inactive or no longer exists")

        _generate_and_send_otp(connection, user)

    return {
        "otp_token": create_otp_pending_token(user["id"]),
        "expires_in": OTP_EXPIRE_MINUTES * 60,
    }


@router.get("/me")
def get_me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    result = {
        "id": current_user["id"],
        "email": current_user["email"],
        "full_name": current_user["full_name"],
        "role": current_user["role"],
    }
    if current_user["role"] == "partner":
        result.update(_partner_org_fields(current_user["id"]))
    elif current_user["role"] == "member":
        result.update(_partner_user_org_fields(current_user["id"]))
    return result


@router.post("/logout")
def logout(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, str]:
    """Invalidate this user's access token(s) server-side. Clearing the
    browser session alone is not enough — a Bearer token captured before
    logout (e.g. in Burp Repeater) must stop authorizing
    POST /api/partner-user/orders and every other protected route."""
    revoke_user_sessions(current_user["id"])
    return {"message": "Logged out"}


@router.post("/change-password")
def change_password(payload: ChangePasswordPayload, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, str]:
    """Self-service password change for a logged-in user of any role — the
    profile-menu counterpart to the invite/reset-link bootstrap (set-password
    above) and Manage Users' admin-triggered reset-password. Requires the
    current password so a hijacked-but-unlocked session can't be used to lock
    the real owner out."""
    password_error = validate_password_strength(payload.new_password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    with get_transaction() as connection:
        user = connection.execute(
            "SELECT password_hash FROM users WHERE id = %s",
            (current_user["id"],),
        ).fetchone()
        if not user or not verify_password(payload.current_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        connection.execute(
            """
            UPDATE users
            SET password_hash = %s,
                token_version = COALESCE(token_version, 0) + 1,
                modified_at = now()
            WHERE id = %s
            """,
            (hash_password(payload.new_password), current_user["id"]),
        )

    return {"message": "Password changed successfully"}


@router.post("/test-mail", dependencies=[Depends(get_current_admin)])
def test_mail(payload: TestMailPayload) -> dict[str, str]:
    """Send a test email and return detailed error if it fails. Admin-only diagnostic endpoint."""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    mail_from = os.getenv("MAIL_FROM", smtp_user or "")

    config_info = {
        "SMTP_HOST": smtp_host or "NOT SET",
        "SMTP_PORT": str(smtp_port),
        "SMTP_USER": smtp_user or "NOT SET",
        "SMTP_PASSWORD": ("SET (" + str(len(smtp_password)) + " chars)") if smtp_password else "NOT SET",
        "MAIL_FROM": mail_from or "NOT SET",
    }

    if not smtp_host or not smtp_user or not smtp_password:
        raise HTTPException(status_code=500, detail={"error": "SMTP not configured", "config": config_info})

    try:
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = "LegalDesk – SMTP Test"
        msg["From"] = mail_from
        msg["To"] = payload.to_email
        msg.set_content("This is a test email from LegalDesk backend. SMTP is working correctly.")

        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.set_debuglevel(0)
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_password.replace(" ", ""))
            server.send_message(msg)

        return {"status": "sent", "to": payload.to_email, "config": config_info}

    except smtplib.SMTPAuthenticationError as e:
        raise HTTPException(status_code=500, detail={"error": f"Auth failed: {e}", "config": config_info, "fix": "For Gmail use App Password not your login password. Go to myaccount.google.com/apppasswords"})
    except smtplib.SMTPException as e:
        raise HTTPException(status_code=500, detail={"error": f"SMTP error: {e}", "config": config_info})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": f"Unexpected: {e}", "config": config_info})


@router.get("/reset-token/{token}")
def validate_reset_token(token: str) -> dict[str, Any]:
    """Validate a password reset token and return the user's name/email. Public — used by the set-password page."""
    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT id, email, full_name
            FROM users
            WHERE password_reset_token = %s
              AND password_reset_expires_at > now()
            """,
            (token,),
        ).fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Invalid or expired reset link")

    return {"email": user["email"], "full_name": user["full_name"]}


@router.post("/set-password")
def set_password(payload: SetPasswordPayload) -> dict[str, str]:
    """Set the user's password using a valid reset token. Public — this IS the login-credential bootstrap step."""
    password_error = validate_password_strength(payload.password)
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    with get_transaction() as connection:
        user = connection.execute(
            """
            SELECT id
            FROM users
            WHERE password_reset_token = %s
              AND password_reset_expires_at > now()
            """,
            (payload.token,),
        ).fetchone()

        if not user:
            raise HTTPException(status_code=400, detail="Invalid or expired reset link")

        connection.execute(
            """
            UPDATE users
            SET password_hash = %s,
                password_reset_token = NULL,
                password_reset_expires_at = NULL,
                token_version = COALESCE(token_version, 0) + 1,
                modified_at = now()
            WHERE id = %s
            """,
            (hash_password(payload.password), user["id"]),
        )

    return {"message": "Password set successfully. You can now log in."}
