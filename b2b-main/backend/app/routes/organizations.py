from pathlib import Path
from typing import Any, Literal
from uuid import UUID
import os
import secrets

from app.email_service import send_password_reset_email

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from psycopg.errors import UniqueViolation

from app.auth import get_current_admin, hash_password, validate_password_strength
from app.database import get_connection, get_transaction
from app.notification_service import notify_insufficient_balance, notify_wallet_deducted, notify_wallet_recharged
from app.routes.charges import get_active_charge_names
from app.routes.services import get_active_service_names
from app.validators import validate_mobile

router = APIRouter()

PARTNER_TYPES = ("Dealer", "Retailer")
RETAILER_CATEGORIES = ("Banks", "Co-Operative Bank", "Co-Operative Societies", "NBFC", "PSC")
PAYMENT_MODES = ("Wallet", "PPS")

# Mirrors partner.py's ORDER_STATUSES; duplicated as a literal rather than
# imported since partner.py already imports from this module — importing
# back would create a circular import.
STATUS_COMPLETED = "Completed"


class OrganizationCreate(BaseModel):
    organization_name: str
    organization_type: str
    retailer_category: str | None = None
    payment_mode: str = "Wallet"
    contact_person: str | None = None
    email: EmailStr
    mobile: str | None = None
    state_id: UUID | None = None
    gst_number: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    pincode: str | None = None
    is_active: bool = True

    _validate_mobile = field_validator("mobile")(validate_mobile)


class OrganizationUpdate(BaseModel):
    organization_name: str | None = None
    organization_type: str | None = None
    retailer_category: str | None = None
    payment_mode: str | None = None
    contact_person: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    state_id: UUID | None = None
    gst_number: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    pincode: str | None = None
    is_active: bool | None = None
    # Not an organizations column — see update_organization, which routes
    # this to the org's primary login user (auth.py's users.two_factor_enabled)
    # via _primary_login_user_id, the same account organizations.email
    # already gets synced to below.
    two_factor_enabled: bool | None = None

    _validate_mobile = field_validator("mobile")(validate_mobile)


class OrganizationUserCreate(BaseModel):
    user_id: UUID | None = None
    full_name: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    # When set, the account is activated immediately with this password
    # instead of the "pending_invite" + set-password-email flow. Portal
    # access (Partner Panel vs Users Portal) is decided server-side from the
    # organization's type, not from client input — see create_or_link_organization_user.
    password: str | None = None
    role: str = "member"
    is_active: bool = True
    # Email-OTP 2FA for this login account (see routes/auth.py's login/
    # verify-otp/resend-otp) — off by default, per-user, independent of role.
    two_factor_enabled: bool = False

    _validate_mobile = field_validator("mobile")(validate_mobile)

    @field_validator("password")
    @classmethod
    def _validate_password(cls, value: str | None) -> str | None:
        if value is not None:
            error = validate_password_strength(value)
            if error:
                raise ValueError(error)
        return value


class OrganizationUserFormCreate(OrganizationUserCreate):
    organization_id: UUID


class OrganizationUserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    role: str | None = None
    is_active: bool | None = None
    two_factor_enabled: bool | None = None

    _validate_mobile = field_validator("mobile")(validate_mobile)


class ServiceAccessCreate(BaseModel):
    quotation_id: UUID | None = None
    services: list[str]


class WalletTransactionCreate(BaseModel):
    type: str
    amount: float
    description: str | None = None
    # Optional — tags a credit as having been raised specifically to cover a
    # short balance on this order (e.g. an eStamp Bulk order whose face value
    # exceeds what's currently in the wallet). See create_wallet_transaction.
    order_id: UUID | None = None


class WalletCreditCreate(BaseModel):
    amount: float
    description: str | None = None
    # Optional — same purpose as WalletTransactionCreate.order_id above: tags
    # this credit as having been raised specifically to cover a short balance
    # on this Partner User's own order, so it's excluded from the standalone
    # "Wallet Reimbursement" list and instead shown/invoiced as part of that
    # order (see reports.get_order_report_detail /
    # partner._auto_generate_wallet_reimbursement_invoices_on_completion).
    order_id: UUID | None = None


class ServicePricingItem(BaseModel):
    service_name: str
    is_active: bool = False
    price: float | None = None


class OrganizationPricingUpdate(BaseModel):
    services: list[ServicePricingItem] = []


class ChargePricingItem(BaseModel):
    charge_name: str
    is_active: bool = False
    price: float | None = None


class OrganizationChargePricingUpdate(BaseModel):
    charges: list[ChargePricingItem] = []


def auto_grant_active_org_services(connection, organization_id: UUID, organization_user_id: UUID) -> None:
    # A Dealer partner's users only see a service under Create Order once it
    # has a partner_user_services row for them specifically (see
    # partner.list_partner_user_services) — the per-org toggle here alone
    # isn't enough. Without this, a brand new user starts blind to every
    # service the partner already pays for, and would need a separate manual
    # "Manage Services" grant per service before they could use any of them.
    connection.execute(
        """
        INSERT INTO partner_user_services (organization_user_id, service_pricing_id)
        SELECT %(organization_user_id)s, sp.id
        FROM organization_service_pricing sp
        WHERE sp.organization_id = %(organization_id)s
            AND sp.is_active = true
            AND sp.service_name != 'Document Service'
        ON CONFLICT (organization_user_id, service_pricing_id) DO NOTHING
        """,
        {"organization_user_id": organization_user_id, "organization_id": organization_id},
    )
    connection.execute(
        """
        INSERT INTO partner_user_services (organization_user_id, document_config_id)
        SELECT %(organization_user_id)s, odc.id
        FROM organization_document_config odc
        WHERE odc.organization_id = %(organization_id)s
            AND odc.status = true
        ON CONFLICT (organization_user_id, document_config_id) DO NOTHING
        """,
        {"organization_user_id": organization_user_id, "organization_id": organization_id},
    )


def create_or_link_organization_user(
    *,
    organization_id: UUID,
    payload: OrganizationUserCreate,
) -> dict[str, Any]:
    with get_transaction() as connection:
        organization = connection.execute(
            "SELECT organization_type FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        # Portal access is decided by the organization's type, not by
        # client-supplied role: Dealer partners' users log into the full
        # Partner Panel (role='partner'); Retailer partners' users log into
        # the Users Portal (role='member') — same as a partner manually
        # adding their own users via partner.create_partner_user.
        portal_role = "partner" if organization["organization_type"] == "Dealer" else "member"

        user_id = payload.user_id
        mail_sent = False
        mail_error: str | None = None
        reset_link: str | None = None

        if not user_id:
            if not payload.email:
                raise HTTPException(status_code=400, detail="email is required when user_id is not provided")

            should_send_invite = False
            existing_user = connection.execute(
                """
                SELECT id, password_hash
                FROM users
                WHERE lower(email) = lower(%s)
                """,
                (str(payload.email),),
            ).fetchone()

            if existing_user:
                user_id = existing_user["id"]
                is_pending = existing_user["password_hash"] == "pending_invite"
                should_send_invite = is_pending and not payload.password

                update_fields = ["modified_at = now()"]
                params: dict[str, Any] = {"user_id": user_id}
                if payload.full_name:
                    update_fields.append("full_name = COALESCE(NULLIF(%(full_name)s, ''), full_name)")
                    params["full_name"] = payload.full_name
                # Only ever set a password / portal role directly on an
                # account still pending activation — never overwrite an
                # already-active identity's real password or role just
                # because it's being linked into another organization.
                if is_pending:
                    update_fields.append("role = %(role)s")
                    params["role"] = portal_role
                    update_fields.append("two_factor_enabled = %(two_factor_enabled)s")
                    params["two_factor_enabled"] = payload.two_factor_enabled
                    if payload.password:
                        update_fields.append("password_hash = %(password_hash)s")
                        update_fields.append("password_reset_token = NULL")
                        update_fields.append("password_reset_expires_at = NULL")
                        params["password_hash"] = hash_password(payload.password)
                connection.execute(
                    f"UPDATE users SET {', '.join(update_fields)} WHERE id = %(user_id)s",
                    params,
                )
            else:
                user = connection.execute(
                    """
                    INSERT INTO users (
                        id,
                        email,
                        password_hash,
                        full_name,
                        is_active,
                        created_at,
                        role,
                        two_factor_enabled
                    )
                    VALUES (
                        gen_random_uuid(),
                        %s,
                        %s,
                        %s,
                        true,
                        now(),
                        %s,
                        %s
                    )
                    RETURNING id
                    """,
                    (
                        str(payload.email),
                        hash_password(payload.password) if payload.password else "pending_invite",
                        payload.full_name,
                        portal_role,
                        payload.two_factor_enabled,
                    ),
                ).fetchone()
                user_id = user["id"]
                should_send_invite = not payload.password

            if should_send_invite:
                # Generate a password reset token/expiry; invite email is sent later via the resend-invite action.
                try:
                    token = secrets.token_urlsafe(32)
                    connection.execute(
                        """
                        UPDATE users
                        SET password_reset_token = %s,
                            password_reset_expires_at = now() + interval '24 hours'
                        WHERE id = %s
                        """,
                        (token, user_id),
                    )
                    reset_link = f"/set-password/{token}"
                    mail_sent = False
                except Exception as e:
                    mail_sent = False
                    mail_error = str(e)

        existing_link = connection.execute(
            """
            SELECT *
            FROM organization_users
            WHERE organization_id = %s AND user_id = %s
            """,
            (organization_id, user_id),
        ).fetchone()

        if existing_link:
            row = dict(existing_link)
            row.update({"mail_sent": mail_sent, "mail_error": mail_error, "reset_link": reset_link})
            return row

        inserted = connection.execute(
            """
            INSERT INTO organization_users (organization_id, user_id, role, is_active, mobile)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (organization_id, user_id, portal_role, payload.is_active, payload.mobile),
        ).fetchone()
        auto_grant_active_org_services(connection, organization_id, inserted["id"])
        row = dict(inserted)
        row.update({"mail_sent": mail_sent, "mail_error": mail_error, "reset_link": reset_link})
        return row


@router.get("")
def list_organizations() -> list[dict[str, Any]]:
    sql = """
        SELECT
            o.id,
            o.organization_name,
            o.organization_type,
            o.retailer_category,
            o.payment_mode,
            o.dealer_id,
            d.organization_name AS dealer_name,
            o.contact_person,
            o.email,
            o.mobile,
            o.state_id,
            s.state_name,
            o.gst_number,
            o.address_line1,
            o.address_line2,
            o.city,
            o.pincode,
            o.is_active,
            o.created_at,
            COUNT(ou.id)::int AS users_count,
            COALESCE(ow.balance, 0) AS wallet_balance,
            login_user.two_factor_enabled
        FROM organizations o
        LEFT JOIN state s ON s.id = o.state_id
        LEFT JOIN organizations d ON d.id = o.dealer_id
        LEFT JOIN organization_users ou ON ou.organization_id = o.id
        LEFT JOIN organization_wallet ow ON ow.organization_id = o.id
        LEFT JOIN LATERAL (
            -- Same "oldest active organization_users row" this org's login
            -- resolves to everywhere else — see _primary_login_user_id.
            SELECT u.two_factor_enabled
            FROM organization_users pou
            JOIN users u ON u.id = pou.user_id
            WHERE pou.organization_id = o.id AND pou.is_active = true
            ORDER BY pou.created_at ASC
            LIMIT 1
        ) login_user ON true
        GROUP BY o.id, s.state_name, d.organization_name, ow.balance, login_user.two_factor_enabled
        ORDER BY o.created_at DESC
    """
    with get_connection() as connection:
        rows = connection.execute(sql).fetchall()

        # Retailers spend from their own user wallet, not the org-level pool
        # this query otherwise reads — swap the number so the Partner List's
        # Wallet column matches what Manage Wallet (and the Retailer's own
        # portal) actually shows.
        for row in rows:
            if row["organization_type"] != "Retailer":
                continue
            member_id = _retailer_member_id(connection, row["id"])
            if not member_id:
                continue
            wallet = connection.execute(
                "SELECT balance FROM organization_user_wallet WHERE organization_user_id = %s",
                (member_id,),
            ).fetchone()
            row["wallet_balance"] = wallet["balance"] if wallet else 0

    return rows


@router.post("", status_code=201)
def create_organization(payload: OrganizationCreate) -> dict[str, Any]:
    if payload.organization_type not in PARTNER_TYPES:
        raise HTTPException(status_code=400, detail=f"organization_type must be one of {PARTNER_TYPES}")
    if payload.payment_mode not in PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"payment_mode must be one of {PAYMENT_MODES}")

    data = payload.model_dump()
    if payload.organization_type == "Retailer":
        if not payload.retailer_category:
            raise HTTPException(status_code=400, detail="retailer_category is required for Retailer partners")
        if payload.retailer_category not in RETAILER_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"retailer_category must be one of {RETAILER_CATEGORIES}")
    else:
        data["retailer_category"] = None

    sql = """
        INSERT INTO organizations (
            organization_name,
            organization_type,
            retailer_category,
            payment_mode,
            contact_person,
            email,
            mobile,
            state_id,
            gst_number,
            address_line1,
            address_line2,
            city,
            pincode,
            is_active
        )
        VALUES (
            %(organization_name)s,
            %(organization_type)s,
            %(retailer_category)s,
            %(payment_mode)s,
            %(contact_person)s,
            %(email)s,
            %(mobile)s,
            %(state_id)s,
            %(gst_number)s,
            %(address_line1)s,
            %(address_line2)s,
            %(city)s,
            %(pincode)s,
            %(is_active)s
        )
        RETURNING *
    """
    with get_connection() as connection:
        try:
            return connection.execute(sql, data).fetchone()
        except UniqueViolation:
            raise HTTPException(
                status_code=409,
                detail=f"An organization with email '{payload.email}' already exists",
            )


@router.post("/users", status_code=201)
def add_organization_user_from_form(payload: OrganizationUserFormCreate) -> dict[str, Any]:
    return create_or_link_organization_user(
        organization_id=payload.organization_id,
        payload=payload,
    )


@router.get("/{organization_id}")
def get_organization(organization_id: UUID) -> dict[str, Any]:
    sql = """
        SELECT o.*, s.state_name, d.organization_name AS dealer_name, login_user.two_factor_enabled
        FROM organizations o
        LEFT JOIN state s ON s.id = o.state_id
        LEFT JOIN organizations d ON d.id = o.dealer_id
        LEFT JOIN LATERAL (
            SELECT u.two_factor_enabled
            FROM organization_users pou
            JOIN users u ON u.id = pou.user_id
            WHERE pou.organization_id = o.id AND pou.is_active = true
            ORDER BY pou.created_at ASC
            LIMIT 1
        ) login_user ON true
        WHERE o.id = %s
    """
    with get_connection() as connection:
        organization = connection.execute(sql, (organization_id,)).fetchone()

    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    return organization


def _primary_login_user_id(connection, organization_id: UUID) -> UUID | None:
    # The organization's own oldest active login — a Retailer's single
    # member IS the organization (see _retailer_member_id above); a Dealer
    # may have several 'partner' users, in which case the oldest one is
    # treated as the primary account this org's own contact email should
    # stay in sync with (see update_organization's email-sync below).
    row = connection.execute(
        """
        SELECT user_id FROM organization_users
        WHERE organization_id = %s AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (organization_id,),
    ).fetchone()
    return row["user_id"] if row else None


@router.patch("/{organization_id}")
def update_organization(organization_id: UUID, payload: OrganizationUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    # Not an organizations column (see OrganizationUpdate) — pull it out
    # before the generic organizations UPDATE below, and apply it to the
    # org's primary login user instead.
    two_factor_enabled = data.pop("two_factor_enabled", None)

    with get_transaction() as connection:
        current = connection.execute(
            "SELECT organization_type, retailer_category, email FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Organization not found")

        # Legacy pre-migration partners may hold organization_type values outside
        # the fixed Dealer/Retailer set — only enforce the fixed set when the
        # value is actually being changed, so editing other fields on an old
        # partner doesn't force an unrelated reclassification.
        if "organization_type" in data and data["organization_type"] != current["organization_type"]:
            if data["organization_type"] not in PARTNER_TYPES:
                raise HTTPException(status_code=400, detail=f"organization_type must be one of {PARTNER_TYPES}")

        if "payment_mode" in data and data["payment_mode"] not in PAYMENT_MODES:
            raise HTTPException(status_code=400, detail=f"payment_mode must be one of {PAYMENT_MODES}")

        effective_type = data.get("organization_type", current["organization_type"])
        effective_category = data.get("retailer_category", current["retailer_category"])

        if effective_type == "Retailer":
            if not effective_category:
                raise HTTPException(status_code=400, detail="retailer_category is required for Retailer partners")
            if effective_category not in RETAILER_CATEGORIES:
                raise HTTPException(status_code=400, detail=f"retailer_category must be one of {RETAILER_CATEGORIES}")
        elif effective_type == "Dealer" and "retailer_category" not in data and current["retailer_category"]:
            data["retailer_category"] = None

        # organizations.email is shown/edited as this partner's email on the
        # Partner List "Edit" form, but the ACTUAL login credential lives on
        # the linked users row (see auth.login, which authenticates against
        # users.email — it never reads organizations.email). Without this,
        # changing a partner's email here silently locks them out: the new
        # address doesn't match any login row, and the old address (still
        # correct in `users`) no longer shows anywhere in the UI as "the"
        # email, so nobody knows to use it.
        if "email" in data and data["email"] != current["email"]:
            login_user_id = _primary_login_user_id(connection, organization_id)
            if login_user_id:
                conflict = connection.execute(
                    "SELECT id FROM users WHERE lower(email) = lower(%s) AND id != %s",
                    (data["email"], login_user_id),
                ).fetchone()
                if conflict:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"'{data['email']}' is already used by another account and can't become "
                            "this partner's login email"
                        ),
                    )
                connection.execute(
                    "UPDATE users SET email = %s, modified_at = now() WHERE id = %s",
                    (data["email"], login_user_id),
                )

        if two_factor_enabled is not None:
            # The Edit Partner form always submits this field (it's a plain
            # toggle, not an opt-in one), so a legacy/user-less org must not
            # fail an otherwise-unrelated save just because it has nothing to
            # sync 2FA onto — only actually enabling it with nowhere to put
            # it is a real error.
            login_user_id = _primary_login_user_id(connection, organization_id)
            if login_user_id:
                connection.execute(
                    "UPDATE users SET two_factor_enabled = %s, modified_at = now() WHERE id = %s",
                    (two_factor_enabled, login_user_id),
                )
            elif two_factor_enabled:
                raise HTTPException(
                    status_code=400,
                    detail="This partner has no login account yet — add a user before enabling 2FA",
                )

        if data:
            assignments = [f"{field} = %({field})s" for field in data]
            data["organization_id"] = organization_id
            sql = f"""
                UPDATE organizations
                SET {", ".join(assignments)}, updated_at = now()
                WHERE id = %(organization_id)s
                RETURNING *
            """
            organization = connection.execute(sql, data).fetchone()
        else:
            organization = connection.execute(
                "SELECT * FROM organizations WHERE id = %s", (organization_id,)
            ).fetchone()

    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = dict(organization)
    if two_factor_enabled is not None:
        result["two_factor_enabled"] = two_factor_enabled
    return result


@router.delete("/{organization_id}")
def delete_organization(organization_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        deleted = connection.execute(
            """
            DELETE FROM organizations
            WHERE id = %s
            RETURNING id
            """,
            (organization_id,),
        ).fetchone()

    if not deleted:
        raise HTTPException(status_code=404, detail="Organization not found")

    return {"message": "Organization deleted successfully"}


@router.get("/{organization_id}/users")
def list_organization_users(organization_id: UUID) -> list[dict[str, Any]]:
    sql = """
        SELECT
            ou.id,
            ou.organization_id,
            ou.user_id,
            ou.role AS organization_role,
            ou.is_active,
            ou.mobile,
            ou.created_at,
            u.email,
            u.full_name,
            u.two_factor_enabled,
            r.role_name
        FROM organization_users ou
        JOIN users u ON u.id = ou.user_id
        LEFT JOIN role r ON r.role_name = u.role
        WHERE ou.organization_id = %s
        ORDER BY ou.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, (organization_id,)).fetchall()


@router.post("/{organization_id}/users", status_code=201)
def add_organization_user(organization_id: UUID, payload: OrganizationUserCreate) -> dict[str, Any]:
    return create_or_link_organization_user(
        organization_id=organization_id,
        payload=payload,
    )


def _get_organization_user(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                ou.id,
                ou.organization_id,
                ou.user_id,
                ou.role AS organization_role,
                ou.is_active,
                ou.mobile,
                ou.created_at,
                u.email,
                u.full_name,
                u.two_factor_enabled,
                r.role_name
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            LEFT JOIN role r ON r.role_name = u.role
            WHERE ou.organization_id = %s AND ou.id = %s
            """,
            (organization_id, membership_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row


@router.get("/{organization_id}/users/{membership_id}")
def get_organization_user(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
    return _get_organization_user(organization_id, membership_id)


@router.patch("/{organization_id}/users/{membership_id}")
def update_organization_user(organization_id: UUID, membership_id: UUID, payload: OrganizationUserUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    with get_transaction() as connection:
        membership = connection.execute(
            "SELECT id, user_id FROM organization_users WHERE organization_id = %s AND id = %s",
            (organization_id, membership_id),
        ).fetchone()
        if not membership:
            raise HTTPException(status_code=404, detail="User not found")

        user_fields = {k: v for k, v in data.items() if k in ("full_name", "email", "two_factor_enabled")}
        if user_fields:
            assignments = ", ".join(f"{field} = %({field})s" for field in user_fields)
            user_fields["user_id"] = membership["user_id"]
            try:
                connection.execute(
                    f"UPDATE users SET {assignments}, modified_at = now() WHERE id = %(user_id)s",
                    user_fields,
                )
            except UniqueViolation:
                raise HTTPException(status_code=409, detail="A user with this email already exists")

        membership_fields = {k: v for k, v in data.items() if k in ("role", "is_active", "mobile")}
        if membership_fields:
            assignments = ", ".join(f"{field} = %({field})s" for field in membership_fields)
            membership_fields["membership_id"] = membership_id
            connection.execute(
                f"UPDATE organization_users SET {assignments} WHERE id = %(membership_id)s",
                membership_fields,
            )

    return _get_organization_user(organization_id, membership_id)


@router.post("/{organization_id}/users/{membership_id}/reset-password")
def reset_organization_user_password(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
    with get_transaction() as connection:
        membership = connection.execute(
            """
            SELECT ou.id, ou.user_id, u.email, u.full_name
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            WHERE ou.organization_id = %s AND ou.id = %s
            """,
            (organization_id, membership_id),
        ).fetchone()
        if not membership:
            raise HTTPException(status_code=404, detail="User not found")

        token = secrets.token_urlsafe(32)
        connection.execute(
            """
            UPDATE users
            SET password_reset_token = %s, password_reset_expires_at = now() + interval '24 hours'
            WHERE id = %s
            """,
            (token, membership["user_id"]),
        )

    reset_link = f"/set-password/{token}"
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    absolute_reset_link = f"{frontend_url}{reset_link}"
    mail_sent = False
    mail_error = None
    try:
        send_password_reset_email(
            to_email=membership["email"],
            full_name=membership["full_name"] or "",
            reset_link=absolute_reset_link,
        )
        mail_sent = True
    except Exception as e:
        mail_error = str(e)

    return {"mail_sent": mail_sent, "mail_error": mail_error, "reset_link": reset_link}


@router.get("/{organization_id}/service-access")
def list_service_access(organization_id: UUID) -> list[dict[str, Any]]:
    sql = """
        SELECT *
        FROM customer_service_access
        WHERE organization_id = %s
        ORDER BY activated_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, (organization_id,)).fetchall()


@router.post("/{organization_id}/service-access", status_code=201)
def create_service_access(organization_id: UUID, payload: ServiceAccessCreate) -> list[dict[str, Any]]:
    if not payload.services:
        raise HTTPException(status_code=400, detail="services are required")

    rows = []
    with get_transaction() as connection:
        connection.execute(
            """
            UPDATE customer_service_access
            SET is_active = false
            WHERE organization_id = %s
            """,
            (organization_id,),
        )
        for service_name in payload.services:
            row = connection.execute(
                """
                INSERT INTO customer_service_access (
                    organization_id,
                    service_name,
                    is_active,
                    quotation_id
                )
                VALUES (%s, %s, true, %s)
                RETURNING *
                """,
                (organization_id, service_name, payload.quotation_id),
            ).fetchone()
            rows.append(row)

    return rows


def _retailer_member_id(connection, organization_id: UUID) -> UUID | None:
    # A Retailer's single auto-created login IS the organization — there's no
    # downstream distribution step like a Dealer handing funds to its Cyber
    # Shop users, so its "wallet" should be that one user's wallet, not a
    # pooled org-level balance nobody's portal ever reads from.
    row = connection.execute(
        """
        SELECT ou.id
        FROM organizations o
        JOIN organization_users ou ON ou.organization_id = o.id
        WHERE o.id = %s AND o.organization_type = 'Retailer'
        ORDER BY ou.created_at ASC
        LIMIT 1
        """,
        (organization_id,),
    ).fetchone()
    return row["id"] if row else None


def _member_wallet_view(connection, organization_user_id: UUID) -> dict[str, Any]:
    wallet = connection.execute(
        "SELECT balance, updated_at FROM organization_user_wallet WHERE organization_user_id = %s",
        (organization_user_id,),
    ).fetchone()
    if not wallet:
        wallet = {"balance": 0, "updated_at": None}

    transactions = connection.execute(
        """
        SELECT t.id, t.type, t.amount, t.balance_after, t.description, t.created_at, t.order_id,
               EXISTS(SELECT 1 FROM b2b_invoices bi WHERE bi.organization_user_wallet_transaction_id = t.id) AS has_invoice
        FROM organization_user_wallet_transactions t
        WHERE t.organization_user_id = %s
        ORDER BY t.created_at DESC
        LIMIT 50
        """,
        (organization_user_id,),
    ).fetchall()

    totals = connection.execute(
        """
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits,
            COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) AS total_debits
        FROM organization_user_wallet_transactions
        WHERE organization_user_id = %s
        """,
        (organization_user_id,),
    ).fetchone()

    return {**wallet, **totals, "transactions": transactions}


@router.get("/wallets/summary")
def list_wallet_summary() -> list[dict[str, Any]]:
    sql = """
        SELECT
            o.id AS organization_id,
            o.organization_name,
            o.organization_type AS partner_type,
            COALESCE(w.balance, 0) AS balance,
            COALESCE(agg.total_credits, 0) AS total_credits,
            COALESCE(agg.total_debits, 0) AS total_debits
        FROM organizations o
        LEFT JOIN organization_wallet w ON w.organization_id = o.id
        LEFT JOIN (
            SELECT
                organization_id,
                SUM(amount) FILTER (WHERE type = 'credit') AS total_credits,
                SUM(amount) FILTER (WHERE type = 'debit') AS total_debits
            FROM wallet_transactions
            GROUP BY organization_id
        ) agg ON agg.organization_id = o.id
        WHERE o.payment_mode IS DISTINCT FROM 'PPS'
        ORDER BY o.organization_name ASC
    """
    with get_connection() as connection:
        rows = connection.execute(sql).fetchall()

        # Retailers spend from their own user wallet, not the org-level pool
        # this query otherwise reads — swap the numbers so this list matches
        # what the Retailer actually sees in their own portal.
        for row in rows:
            member_id = _retailer_member_id(connection, row["organization_id"])
            if not member_id:
                continue
            totals = connection.execute(
                """
                SELECT
                    COALESCE(balance, 0) AS balance,
                    COALESCE((SELECT SUM(amount) FROM organization_user_wallet_transactions WHERE organization_user_id = %(id)s AND type = 'credit'), 0) AS total_credits,
                    COALESCE((SELECT SUM(amount) FROM organization_user_wallet_transactions WHERE organization_user_id = %(id)s AND type = 'debit'), 0) AS total_debits
                FROM organization_user_wallet
                WHERE organization_user_id = %(id)s
                """,
                {"id": member_id},
            ).fetchone()
            if totals:
                row["balance"] = totals["balance"]
                row["total_credits"] = totals["total_credits"]
                row["total_debits"] = totals["total_debits"]
            else:
                row["balance"] = 0
                row["total_credits"] = 0
                row["total_debits"] = 0

    return rows


@router.get("/{organization_id}/wallet")
def get_wallet(organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        member_id = _retailer_member_id(connection, organization_id)
        if member_id:
            return {"organization_id": organization_id, **_member_wallet_view(connection, member_id)}

        wallet = connection.execute(
            """
            SELECT organization_id, balance, updated_at
            FROM organization_wallet
            WHERE organization_id = %s
            """,
            (organization_id,),
        ).fetchone()
        if not wallet:
            wallet = {"organization_id": organization_id, "balance": 0, "updated_at": None}

        transactions = connection.execute(
            """
            SELECT t.id, t.organization_id, t.type, t.amount, t.balance_after, t.description, t.created_at, t.order_id,
                   EXISTS(SELECT 1 FROM b2b_invoices bi WHERE bi.wallet_transaction_id = t.id) AS has_invoice
            FROM wallet_transactions t
            WHERE t.organization_id = %s
            ORDER BY t.created_at DESC
            LIMIT 50
            """,
            (organization_id,),
        ).fetchall()

        totals = connection.execute(
            """
            SELECT
                COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits,
                COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) AS total_debits
            FROM wallet_transactions
            WHERE organization_id = %s
            """,
            (organization_id,),
        ).fetchone()

    return {**wallet, **totals, "transactions": transactions}


def _apply_wallet_transaction(
    connection, *, organization_id: UUID, member_id: UUID | None, type_: str, amount: float, description: str | None,
    order_id: UUID | None = None,
) -> dict[str, Any]:
    """Moves the real wallet balance and records the transaction row — the
    org-level pooled wallet, or (for a Retailer, whose single login IS the
    organization) that member's own wallet directly. Applied immediately for
    both credit and debit (see create_wallet_transaction) — the Reimbursement
    invoice for a credit is a separate, later step (see
    generate_wallet_transaction_invoice), not tied to this at all."""
    if member_id is not None:
        connection.execute(
            """
            INSERT INTO organization_user_wallet (organization_user_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_user_id) DO NOTHING
            """,
            (member_id,),
        )
        current = connection.execute(
            "SELECT balance FROM organization_user_wallet WHERE organization_user_id = %s FOR UPDATE",
            (member_id,),
        ).fetchone()
        delta = amount if type_ == "credit" else -amount
        new_balance = float(current["balance"]) + delta
        if new_balance < 0:
            notify_insufficient_balance(
                organization_id=organization_id, organization_user_id=member_id,
                amount=amount, available=float(current["balance"]),
            )
            raise HTTPException(status_code=400, detail="Insufficient wallet balance")
        connection.execute(
            "UPDATE organization_user_wallet SET balance = %s, updated_at = now() WHERE organization_user_id = %s",
            (new_balance, member_id),
        )
        result = connection.execute(
            """
            INSERT INTO organization_user_wallet_transactions (organization_user_id, type, amount, balance_after, description, order_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, organization_user_id, type, amount, balance_after, description, order_id, created_at
            """,
            (member_id, type_, amount, new_balance, description, order_id),
        ).fetchone()
        if type_ == "credit":
            notify_wallet_recharged(organization_id=organization_id, organization_user_id=member_id, amount=amount)
        else:
            notify_wallet_deducted(
                organization_id=organization_id, organization_user_id=member_id,
                amount=amount, description=description or "Wallet debit by Super Admin",
            )
        return result

    connection.execute(
        """
        INSERT INTO organization_wallet (organization_id, balance)
        VALUES (%s, 0)
        ON CONFLICT (organization_id) DO NOTHING
        """,
        (organization_id,),
    )
    current = connection.execute(
        "SELECT balance FROM organization_wallet WHERE organization_id = %s FOR UPDATE",
        (organization_id,),
    ).fetchone()
    delta = amount if type_ == "credit" else -amount
    new_balance = float(current["balance"]) + delta
    if new_balance < 0:
        notify_insufficient_balance(
            organization_id=organization_id, organization_user_id=None,
            amount=amount, available=float(current["balance"]),
        )
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    connection.execute(
        "UPDATE organization_wallet SET balance = %s, updated_at = now() WHERE organization_id = %s",
        (new_balance, organization_id),
    )
    result = connection.execute(
        """
        INSERT INTO wallet_transactions (organization_id, type, amount, balance_after, description, order_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, organization_id, type, amount, balance_after, description, order_id, created_at
        """,
        (organization_id, type_, amount, new_balance, description, order_id),
    ).fetchone()
    if type_ == "credit":
        notify_wallet_recharged(organization_id=organization_id, organization_user_id=None, amount=amount)
    else:
        notify_wallet_deducted(
            organization_id=organization_id, organization_user_id=None,
            amount=amount, description=description or "Wallet debit by Super Admin",
        )
    return result


@router.post("/{organization_id}/wallet/transactions", status_code=201)
def create_wallet_transaction(organization_id: UUID, payload: WalletTransactionCreate) -> dict[str, Any]:
    """Credits or debits the wallet immediately — a recharge is a single
    action, exactly like every other wallet-touching action in this app.
    The Reimbursement invoice for a credit is deliberately NOT generated
    here anymore: it starts out derived as "Pending" (see
    invoice_service.list_invoices_for_user) until Super Admin separately
    calls generate_wallet_transaction_invoice below — unless this credit is
    tagged to an order (payload.order_id) that's already Completed, in which
    case that order's own completion hook has already run and won't fire
    again, so the Reimbursement invoice is generated right here instead of
    being stranded pending forever."""
    if payload.type not in ("credit", "debit"):
        raise HTTPException(status_code=400, detail="type must be 'credit' or 'debit'")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    with get_transaction() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        order_status = None
        if payload.order_id is not None:
            order = connection.execute(
                "SELECT status FROM orders WHERE id = %s AND organization_id = %s",
                (payload.order_id, organization_id),
            ).fetchone()
            if not order:
                raise HTTPException(status_code=404, detail="Order not found for this partner")
            order_status = order["status"]

        member_id = _retailer_member_id(connection, organization_id)
        result = _apply_wallet_transaction(
            connection, organization_id=organization_id, member_id=member_id,
            type_=payload.type, amount=payload.amount, description=payload.description,
            order_id=payload.order_id,
        )

        if payload.order_id is not None and payload.type == "credit" and order_status == "Completed":
            from app.invoice_service import get_or_create_reimbursement_invoice_for_wallet_credit

            get_or_create_reimbursement_invoice_for_wallet_credit(
                connection, organization_id=organization_id,
                organization_user_id=member_id, amount=payload.amount,
                wallet_transaction_id=None if member_id else result["id"],
                organization_user_wallet_transaction_id=result["id"] if member_id else None,
            )

        return result


@router.post("/{organization_id}/wallet/transactions/{transaction_id}/generate-invoice")
def generate_wallet_transaction_invoice(organization_id: UUID, transaction_id: UUID) -> dict[str, Any]:
    """Super Admin's explicit "mark as complete" action for a wallet credit —
    the moment the Reimbursement invoice actually generates. The wallet
    itself was already credited immediately at create_wallet_transaction
    time; this only ever produces the invoice document, nothing else moves.
    transaction_id may belong to either the org-level wallet_transactions or
    a member's own organization_user_wallet_transactions (a Retailer's own
    recharge) — checked in that order since a given id only ever exists in
    one of the two tables. Idempotent via
    get_or_create_reimbursement_invoice_for_wallet_credit's own existing-row
    check, so clicking this twice for the same transaction can never
    generate a duplicate invoice.
    """
    # Local import — invoice_service imports app.routes.partner, which itself
    # imports from this module (RETAILER_CATEGORIES / get_organization_charge_pricing),
    # so a module-level import here would be circular at app startup.
    from app.invoice_service import get_or_create_reimbursement_invoice_for_wallet_credit

    with get_transaction() as connection:
        org_txn = connection.execute(
            "SELECT id, type, amount FROM wallet_transactions WHERE id = %s AND organization_id = %s",
            (transaction_id, organization_id),
        ).fetchone()
        if org_txn:
            if org_txn["type"] != "credit":
                raise HTTPException(status_code=400, detail="Only a credit transaction has a Reimbursement invoice")
            return get_or_create_reimbursement_invoice_for_wallet_credit(
                connection, organization_id=organization_id, organization_user_id=None,
                amount=org_txn["amount"], wallet_transaction_id=transaction_id,
            )

        member_txn = connection.execute(
            """
            SELECT t.id, t.type, t.amount, t.organization_user_id
            FROM organization_user_wallet_transactions t
            JOIN organization_users ou ON ou.id = t.organization_user_id
            WHERE t.id = %s AND ou.organization_id = %s
            """,
            (transaction_id, organization_id),
        ).fetchone()
        if member_txn:
            if member_txn["type"] != "credit":
                raise HTTPException(status_code=400, detail="Only a credit transaction has a Reimbursement invoice")
            return get_or_create_reimbursement_invoice_for_wallet_credit(
                connection, organization_id=organization_id, organization_user_id=member_txn["organization_user_id"],
                amount=member_txn["amount"], organization_user_wallet_transaction_id=transaction_id,
            )

    raise HTTPException(status_code=404, detail="Wallet transaction not found")


@router.get("/{organization_id}/wallets/users")
def list_user_wallets(organization_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        return connection.execute(
            """
            SELECT
                ou.id AS membership_id,
                u.full_name,
                u.email,
                ou.is_active,
                ou.created_at,
                COALESCE(w.balance, 0) AS balance
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            LEFT JOIN organization_user_wallet w ON w.organization_user_id = ou.id
            WHERE ou.organization_id = %s
            ORDER BY u.full_name ASC
            """,
            (organization_id,),
        ).fetchall()


def _get_user_wallet(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        membership = connection.execute(
            """
            SELECT ou.id AS membership_id, u.full_name, u.email
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            WHERE ou.organization_id = %s AND ou.id = %s
            """,
            (organization_id, membership_id),
        ).fetchone()
        if not membership:
            raise HTTPException(status_code=404, detail="User not found")

        wallet = connection.execute(
            "SELECT balance, updated_at FROM organization_user_wallet WHERE organization_user_id = %s",
            (membership_id,),
        ).fetchone()
        if not wallet:
            wallet = {"balance": 0, "updated_at": None}

        transactions = connection.execute(
            """
            SELECT t.id, t.organization_user_id, t.type, t.amount, t.balance_after, t.description, t.created_at, t.order_id,
                   EXISTS(SELECT 1 FROM b2b_invoices bi WHERE bi.organization_user_wallet_transaction_id = t.id) AS has_invoice
            FROM organization_user_wallet_transactions t
            WHERE t.organization_user_id = %s
            ORDER BY t.created_at DESC
            LIMIT 50
            """,
            (membership_id,),
        ).fetchall()

    return {**membership, **wallet, "transactions": transactions}


@router.get("/{organization_id}/users/{membership_id}/wallet")
def get_user_wallet(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
    return _get_user_wallet(organization_id, membership_id)


@router.post("/{organization_id}/users/{membership_id}/wallet/credit")
def credit_user_wallet(organization_id: UUID, membership_id: UUID, payload: WalletCreditCreate) -> dict[str, Any]:
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    with get_transaction() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        order_status = None
        if payload.order_id is not None:
            order = connection.execute(
                "SELECT status FROM orders WHERE id = %s AND organization_id = %s",
                (payload.order_id, organization_id),
            ).fetchone()
            if not order:
                raise HTTPException(status_code=404, detail="Order not found for this partner")
            order_status = order["status"]

        membership = connection.execute(
            """
            SELECT ou.id, u.full_name
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            WHERE ou.organization_id = %s AND ou.id = %s
            """,
            (organization_id, membership_id),
        ).fetchone()
        if not membership:
            raise HTTPException(status_code=404, detail="User not found")

        # Debit the partner wallet — crediting a user wallet transfers from the partner's own balance.
        connection.execute(
            """
            INSERT INTO organization_wallet (organization_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_id) DO NOTHING
            """,
            (organization_id,),
        )
        partner_wallet = connection.execute(
            "SELECT balance FROM organization_wallet WHERE organization_id = %s FOR UPDATE",
            (organization_id,),
        ).fetchone()
        new_partner_balance = float(partner_wallet["balance"]) - payload.amount
        if new_partner_balance < 0:
            raise HTTPException(status_code=400, detail="Insufficient partner wallet balance")

        connection.execute(
            "UPDATE organization_wallet SET balance = %s, updated_at = now() WHERE organization_id = %s",
            (new_partner_balance, organization_id),
        )
        connection.execute(
            """
            INSERT INTO wallet_transactions (organization_id, type, amount, balance_after, description)
            VALUES (%s, 'debit', %s, %s, %s)
            """,
            (
                organization_id,
                payload.amount,
                new_partner_balance,
                payload.description or f"Transfer to {membership['full_name']}",
            ),
        )

        # Credit the user wallet.
        connection.execute(
            """
            INSERT INTO organization_user_wallet (organization_user_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_user_id) DO NOTHING
            """,
            (membership_id,),
        )
        user_wallet = connection.execute(
            "SELECT balance FROM organization_user_wallet WHERE organization_user_id = %s FOR UPDATE",
            (membership_id,),
        ).fetchone()
        new_user_balance = float(user_wallet["balance"]) + payload.amount

        connection.execute(
            "UPDATE organization_user_wallet SET balance = %s, updated_at = now() WHERE organization_user_id = %s",
            (new_user_balance, membership_id),
        )
        credit_txn = connection.execute(
            """
            INSERT INTO organization_user_wallet_transactions (organization_user_id, type, amount, balance_after, description, order_id)
            VALUES (%s, 'credit', %s, %s, %s, %s)
            RETURNING id
            """,
            (membership_id, payload.amount, new_user_balance, payload.description, payload.order_id),
        ).fetchone()

        # Same reasoning as create_wallet_transaction above: if this credit is
        # tagged to an order that's already Completed, that order's own
        # completion hook has already run and won't fire again — generate the
        # Reimbursement invoice right here instead of leaving it stranded
        # "Pending" with no future trigger to ever pick it up.
        if payload.order_id is not None and order_status == "Completed":
            from app.invoice_service import get_or_create_reimbursement_invoice_for_wallet_credit

            get_or_create_reimbursement_invoice_for_wallet_credit(
                connection, organization_id=organization_id, organization_user_id=membership_id,
                amount=payload.amount, organization_user_wallet_transaction_id=credit_txn["id"],
            )

    # This is the only wallet-crediting path that bypasses
    # _apply_wallet_transaction (it moves money between two wallets in one
    # step, not a plain credit/debit), so it has to fire these itself —
    # matching exactly what _apply_wallet_transaction notifies for the
    # equivalent org-level credit/debit pair.
    notify_wallet_recharged(organization_id=organization_id, organization_user_id=membership_id, amount=payload.amount)
    notify_wallet_deducted(
        organization_id=organization_id, organization_user_id=None,
        amount=payload.amount, description=payload.description or f"Transfer to {membership['full_name']}",
    )

    return _get_user_wallet(organization_id, membership_id)


@router.get("/{organization_id}/pricing")
def get_organization_pricing(organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        service_rows = {
            row["service_name"]: row
            for row in connection.execute(
                """
                SELECT service_name, is_active, price, updated_at
                FROM organization_service_pricing
                WHERE organization_id = %s
                """,
                (organization_id,),
            ).fetchall()
        }

        # "Document Service" is never priced directly (its per-service row's
        # price is always null — pricing instead lives per document/state in
        # organization_document_config). Sum whatever's been configured across
        # every state so the Assigned Services list shows a real total instead
        # of blank, the way every other service already does.
        document_service_total = connection.execute(
            """
            SELECT SUM(base_price) AS total, COUNT(*) AS n
            FROM organization_document_config
            WHERE organization_id = %s AND status = true
            """,
            (organization_id,),
        ).fetchone()

    services = [
        {
            "service_name": name,
            "is_active": service_rows.get(name, {}).get("is_active", False),
            "price": (
                float(document_service_total["total"])
                if name == "Document Service" and document_service_total["n"] > 0 and document_service_total["total"] is not None
                # eStamp Bulk has no Base Price of its own — its stamp value
                # comes from denomination x quantity and its service fee from
                # the "Service Charge" additional charge (see
                # create_bulk_estamp_order), never from this column. Reported
                # as 0 here regardless of what's stored, so a value left over
                # from before this distinction existed can never resurface.
                else 0.0
                if name == "eStamp Bulk"
                else service_rows.get(name, {}).get("price")
            ),
            "updated_at": service_rows.get(name, {}).get("updated_at"),
        }
        for name in get_active_service_names()
    ]

    return {"services": services}


def _price_changed(existing: dict[str, Any] | None, new_price: float | None) -> bool:
    # Saving the pricing form resubmits every service, not just the one the
    # admin edited — so a service that's never had a price set (existing is
    # None) and is still being left unset (new_price is None) is not a real
    # change, just a no-op resave. Only log when a price value actually
    # differs, including the first time a real value is entered.
    existing_price = float(existing["price"]) if existing and existing["price"] is not None else None
    new_price_value = float(new_price) if new_price is not None else None
    return existing_price != new_price_value


@router.put("/{organization_id}/pricing")
def update_organization_pricing(
    organization_id: UUID,
    payload: OrganizationPricingUpdate,
    current_admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    with get_transaction() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        active_services = get_active_service_names()
        for item in payload.services:
            if item.service_name not in active_services:
                raise HTTPException(status_code=400, detail=f"Unknown service '{item.service_name}'")

            # Document Service is never priced directly — get_organization_pricing
            # reports it as the live sum of organization_document_config instead
            # of whatever's stored here. eStamp Bulk is never priced directly
            # either — see get_organization_pricing above. Force this column
            # back to null on every write for both so a stale/computed value
            # never round-trips into storage (which would also spuriously log
            # a "price change" below on saves that never touched it at all).
            item_price = None if item.service_name in ("Document Service", "eStamp Bulk") else item.price

            existing = connection.execute(
                "SELECT price FROM organization_service_pricing WHERE organization_id = %s AND service_name = %s",
                (organization_id, item.service_name),
            ).fetchone()

            pricing_row = connection.execute(
                """
                INSERT INTO organization_service_pricing (organization_id, service_name, is_active, price, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (organization_id, service_name)
                DO UPDATE SET is_active = EXCLUDED.is_active, price = EXCLUDED.price, updated_at = now()
                RETURNING id
                """,
                (organization_id, item.service_name, item.is_active, item_price),
            ).fetchone()

            # Turning a service on for the partner should make it usable by
            # every user they already have, not just future ones — otherwise
            # each existing user needs a separate manual "Manage Services"
            # grant before Create Order will show it (see
            # auto_grant_active_org_services, applied here for every existing
            # user instead of just the one being created).
            if item.is_active and item.service_name != "Document Service":
                connection.execute(
                    """
                    INSERT INTO partner_user_services (organization_user_id, service_pricing_id)
                    SELECT ou.id, %(service_pricing_id)s
                    FROM organization_users ou
                    WHERE ou.organization_id = %(organization_id)s
                    ON CONFLICT (organization_user_id, service_pricing_id) DO NOTHING
                    """,
                    {"organization_id": organization_id, "service_pricing_id": pricing_row["id"]},
                )

            if _price_changed(existing, item_price):
                connection.execute(
                    """
                    INSERT INTO organization_service_price_history (organization_id, service_name, price, changed_by)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (organization_id, item.service_name, item_price, current_admin["id"]),
                )

            # Configured documents only mean something while Document Service is
            # enabled for the partner — turning it off retires any documents
            # already configured for them instead of leaving orphaned rows that
            # a stale UI (or another admin) could still see as "configured".
            if item.service_name == "Document Service" and not item.is_active:
                connection.execute(
                    "UPDATE organization_document_config SET status = false, updated_at = now() "
                    "WHERE organization_id = %s AND status = true",
                    (organization_id,),
                )

    return get_organization_pricing(organization_id)


@router.get("/{organization_id}/pricing/charges")
def get_organization_charge_pricing(organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        charge_rows = {
            row["charge_name"]: row
            for row in connection.execute(
                """
                SELECT charge_name, is_active, price, updated_at
                FROM organization_charge_pricing
                WHERE organization_id = %s
                """,
                (organization_id,),
            ).fetchall()
        }

    charges = [
        {
            "charge_name": name,
            "is_active": charge_rows.get(name, {}).get("is_active", False),
            "price": charge_rows.get(name, {}).get("price"),
            "updated_at": charge_rows.get(name, {}).get("updated_at"),
        }
        for name in get_active_charge_names()
    ]

    return {"charges": charges}


@router.put("/{organization_id}/pricing/charges")
def update_organization_charge_pricing(
    organization_id: UUID,
    payload: OrganizationChargePricingUpdate,
) -> dict[str, Any]:
    with get_transaction() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        active_charges = get_active_charge_names()
        for item in payload.charges:
            if item.charge_name not in active_charges:
                raise HTTPException(status_code=400, detail=f"Unknown charge '{item.charge_name}'")

            connection.execute(
                """
                INSERT INTO organization_charge_pricing (organization_id, charge_name, is_active, price, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (organization_id, charge_name)
                DO UPDATE SET is_active = EXCLUDED.is_active, price = EXCLUDED.price, updated_at = now()
                """,
                (organization_id, item.charge_name, item.is_active, item.price),
            )

    return get_organization_charge_pricing(organization_id)


class ServiceChargeItem(BaseModel):
    charge_name: str
    is_active: bool = True
    # 'amount': `price` is the final charge as-is. 'percentage': the charge is
    # MAX(order_face_value * percentage / 100, minimum_amount) — see
    # create_bulk_estamp_order in partner.py for the one place that actually
    # performs this calculation today. Only meaningful for "Service Charge"
    # on "eStamp Bulk" (the admin UI only offers the percentage option
    # there); every other charge/service combination stays 'amount', so
    # nothing about their behavior changes.
    calculation_type: Literal["amount", "percentage"] = "amount"
    price: float | None = None
    percentage: float | None = None
    minimum_amount: float | None = None

    @model_validator(mode="after")
    def _validate_calculation_fields(self) -> "ServiceChargeItem":
        # Never requires a value to be present — the established workflow
        # here (same as every other charge/price field in this admin UI) is
        # tick the box now, type the real amount later; a blank field is
        # treated as 0 downstream (see partner.py's `float(row["price"] or 0)`
        # pattern), not rejected. Only rejects a value that WAS typed and is
        # actually invalid (negative), so a genuinely bad input still can't
        # slip through.
        if self.price is not None and self.price < 0:
            raise ValueError(f"'{self.charge_name}' amount cannot be negative")
        if self.percentage is not None and self.percentage < 0:
            raise ValueError(f"'{self.charge_name}' percentage cannot be negative")
        if self.minimum_amount is not None and self.minimum_amount < 0:
            raise ValueError(f"'{self.charge_name}' minimum amount cannot be negative")
        return self


class ServiceChargeUpdate(BaseModel):
    charges: list[ServiceChargeItem] = []


@router.get("/{organization_id}/pricing/service-charges")
def get_organization_service_charge_pricing(organization_id: UUID) -> dict[str, Any]:
    """Every additional charge (Delivery Charge, Handling Charge, any
    admin-defined type) assigned to any service for this org — the "Manage
    Services" Services section groups these by service_name client-side.
    Unlike get_organization_pricing/get_organization_charge_pricing above,
    this doesn't pre-populate one row per master entry: charges here are an
    arbitrary, growable per-service list, not a fixed toggle set, so only
    rows that actually exist (assigned, even if since deactivated) come
    back."""
    with get_connection() as connection:
        _require_organization(connection, organization_id)
        rows = connection.execute(
            """
            SELECT service_name, charge_name, is_active, price, calculation_type, percentage, minimum_amount, updated_at
            FROM organization_service_charge_pricing
            WHERE organization_id = %s
            ORDER BY service_name ASC, charge_name ASC
            """,
            (organization_id,),
        ).fetchall()
    return {"charges": rows}


@router.put("/{organization_id}/pricing/services/{service_name}/charges")
def update_organization_service_charge_pricing(
    organization_id: UUID, service_name: str, payload: ServiceChargeUpdate
) -> dict[str, Any]:
    """Full replace of this org+service's assigned additional charges —
    submits the complete desired set every save (mirrors how the frontend
    manages an editable chip list), so a charge missing from the payload is
    one the admin removed and gets deleted here. Never touches the `charge`
    master itself (see charges.py) or any other service/organization's own
    assignments."""
    if service_name not in get_active_service_names():
        raise HTTPException(status_code=400, detail=f"Unknown service '{service_name}'")

    active_charges = get_active_charge_names()
    seen: set[str] = set()
    for item in payload.charges:
        if item.charge_name not in active_charges:
            raise HTTPException(status_code=400, detail=f"Unknown charge '{item.charge_name}'")
        if item.charge_name in seen:
            raise HTTPException(
                status_code=400, detail=f"'{item.charge_name}' is assigned to '{service_name}' more than once"
            )
        seen.add(item.charge_name)
        # 'percentage' is only ever interpreted by create_bulk_estamp_order's
        # Service Charge calculation (see partner.py) — every other order-
        # creation path (create_manual_estamp_order, _create_order) only ever
        # reads this table's plain `price` column, so a percentage-type row
        # there would silently price as ₹0 instead of computing anything.
        # Rejected here rather than left as a latent trap for whichever
        # future caller sends one, since the admin UI already only offers
        # this option for eStamp Bulk's Service Charge in the first place.
        if item.calculation_type == "percentage" and (service_name, item.charge_name) != ("eStamp Bulk", "Service Charge"):
            raise HTTPException(
                status_code=400,
                detail="Percentage-based calculation is only supported for eStamp Bulk's Service Charge.",
            )

    with get_transaction() as connection:
        _require_organization(connection, organization_id)

        connection.execute(
            """
            DELETE FROM organization_service_charge_pricing
            WHERE organization_id = %s AND service_name = %s
              AND NOT (charge_name = ANY(%s))
            """,
            (organization_id, service_name, list(seen)),
        )

        for item in payload.charges:
            # Only the fields relevant to the chosen calculation_type are
            # ever persisted — e.g. switching to 'percentage' clears out a
            # stale `price` rather than leaving it sitting unused, so there's
            # never ambiguity later about which field is authoritative.
            price = item.price if item.calculation_type == "amount" else None
            percentage = item.percentage if item.calculation_type == "percentage" else None
            minimum_amount = item.minimum_amount if item.calculation_type == "percentage" else None
            connection.execute(
                """
                INSERT INTO organization_service_charge_pricing
                    (organization_id, service_name, charge_name, is_active, price, calculation_type, percentage, minimum_amount, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (organization_id, service_name, charge_name)
                DO UPDATE SET
                    is_active = EXCLUDED.is_active,
                    price = EXCLUDED.price,
                    calculation_type = EXCLUDED.calculation_type,
                    percentage = EXCLUDED.percentage,
                    minimum_amount = EXCLUDED.minimum_amount,
                    updated_at = now()
                """,
                (
                    organization_id, service_name, item.charge_name, item.is_active,
                    price, item.calculation_type, percentage, minimum_amount,
                ),
            )

    return get_organization_service_charge_pricing(organization_id)


@router.get("/{organization_id}/pricing/services/{service_name}/history")
def get_service_price_history(
    organization_id: UUID, service_name: str, limit: int = 20, offset: int = 0
) -> dict[str, Any]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    with get_connection() as connection:
        total = connection.execute(
            """
            SELECT COUNT(*) AS n FROM organization_service_price_history
            WHERE organization_id = %s AND service_name = %s
            """,
            (organization_id, service_name),
        ).fetchone()["n"]
        items = connection.execute(
            """
            SELECT h.id, h.price, h.effective_from, h.created_at, u.full_name AS changed_by_name
            FROM organization_service_price_history h
            LEFT JOIN users u ON u.id = h.changed_by
            WHERE h.organization_id = %s AND h.service_name = %s
            ORDER BY h.effective_from DESC
            LIMIT %s OFFSET %s
            """,
            (organization_id, service_name, limit, offset),
        ).fetchall()
    return {"total": total, "items": items}


def _require_organization(connection, organization_id: UUID) -> None:
    organization = connection.execute(
        "SELECT id FROM organizations WHERE id = %s", (organization_id,)
    ).fetchone()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")


# =========================================
# ESTAMP BULK PRICING RULES
#
# Per-partner, Super Admin-configured tiered pricing: an additional charge on
# top of whatever "Service Charge"/other charges are already assigned (see
# update_organization_service_charge_pricing above), applied at order-
# creation time by matching a denomination + quantity to a rule's range (see
# partner.create_bulk_estamp_order / partner._match_bulk_estamp_pricing_rule).
# Every denomination/quantity/charge value is admin-entered — nothing here is
# a fixed business constant.
# =========================================

class BulkEstampPricingRuleIn(BaseModel):
    # 'any': open-ended — admin still enters denomination_from (the range's
    # start); denomination_to is always forced to None (Infinity) below, so
    # this means [denomination_from, Infinity), NOT [0, Infinity). 'customize':
    # the original bounded [denomination_from, denomination_to] range,
    # unchanged. See partner._match_bulk_estamp_pricing_rule for how each
    # type is matched.
    denomination_type: Literal["any", "customize"] = "customize"
    denomination_from: float
    denomination_to: float | None = None
    quantity_from: int
    quantity_to: int | None = None  # None = unlimited
    # 'fixed_amount': `charge` is a ₹ rate per stamp (line service charge =
    # charge x quantity). 'percentage': `charge` is a % of the denomination
    # per stamp (line service charge = denomination x charge/100 x quantity).
    # See partner.calculate_bulk_estamp_line_charge — the one place that
    # formula actually lives.
    charge_type: Literal["fixed_amount", "percentage"] = "fixed_amount"
    charge: float
    is_active: bool = True

    @model_validator(mode="after")
    def _validate_ranges(self) -> "BulkEstampPricingRuleIn":
        if self.denomination_from <= 0:
            raise ValueError("Denomination From must be greater than 0")
        if self.denomination_type == "any":
            self.denomination_to = None  # Always open-ended — the admin can never set a finite upper bound for 'any'.
        else:
            if self.denomination_to is None:
                raise ValueError("Denomination To is required for Customize")
            if self.denomination_to < self.denomination_from:
                raise ValueError("Denomination To must be greater than or equal to Denomination From")
        if self.quantity_from < 1:
            raise ValueError("Quantity From must be at least 1")
        if self.quantity_to is not None and self.quantity_from > self.quantity_to:
            raise ValueError("Quantity From must be less than or equal to Quantity To")
        if self.charge < 0:
            raise ValueError("Charge cannot be negative")
        if self.charge_type == "percentage" and self.charge > 100:
            raise ValueError("Percentage rate must be between 0 and 100")
        return self


# Detects whether two rules' (denomination range) x (quantity range)
# rectangles intersect — if the denomination ranges don't overlap at all,
# the quantity ranges are irrelevant (a given denomination only ever falls in
# one of the two), so this only actually flags an ambiguous match when BOTH
# dimensions overlap. denomination_to None (an 'any' rule) is treated as
# +infinity, same as quantity_to None already is below.
def _ranges_overlap(rule_a: dict[str, Any], rule_b: dict[str, Any]) -> bool:
    a_denom_to = float(rule_a["denomination_to"]) if rule_a["denomination_to"] is not None else float("inf")
    b_denom_to = float(rule_b["denomination_to"]) if rule_b["denomination_to"] is not None else float("inf")
    denom_overlap = float(rule_a["denomination_from"]) <= b_denom_to and float(rule_b["denomination_from"]) <= a_denom_to
    if not denom_overlap:
        return False
    a_to = rule_a["quantity_to"]
    b_to = rule_b["quantity_to"]
    qty_overlap = int(rule_a["quantity_from"]) <= (int(b_to) if b_to is not None else 10**18) and \
                  int(rule_b["quantity_from"]) <= (int(a_to) if a_to is not None else 10**18)
    return qty_overlap


def _check_no_overlap(connection, organization_id: UUID, candidate: dict[str, Any], exclude_rule_id: UUID | None) -> None:
    if not candidate["is_active"]:
        return  # An inactive rule can never be matched, so it can never be ambiguous either.
    existing = connection.execute(
        """
        SELECT id, denomination_type, denomination_from, denomination_to, quantity_from, quantity_to
        FROM organization_estamp_bulk_pricing_rule
        WHERE organization_id = %s AND is_active = true AND id IS DISTINCT FROM %s
        """,
        (organization_id, exclude_rule_id),
    ).fetchall()
    for other in existing:
        # An 'any' rule and a 'customize' rule are never ambiguous with each
        # other — a matching 'customize' rule always takes precedence over
        # 'any' at match time (see partner._match_bulk_estamp_pricing_rule),
        # so the two are allowed to coexist for the same quantity band by
        # design. Only same-type overlaps (two 'customize' ranges, or two
        # 'any' rules covering the same quantity band) are ambiguous.
        if candidate["denomination_type"] != other["denomination_type"]:
            continue
        if _ranges_overlap(candidate, other):
            other_denom = "Any" if other["denomination_type"] == "any" else f"Denomination {other['denomination_from']}–{other['denomination_to']}"
            other_to = other["quantity_to"] if other["quantity_to"] is not None else "Unlimited"
            raise HTTPException(
                status_code=400,
                detail=(
                    f"This rule overlaps with an existing active rule "
                    f"({other_denom}, Quantity {other['quantity_from']}–{other_to}). Adjust the ranges or disable the other rule first."
                ),
            )


@router.get("/{organization_id}/estamp-bulk-pricing-rules")
def list_bulk_estamp_pricing_rules(organization_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        _require_organization(connection, organization_id)
        return connection.execute(
            """
            SELECT id, organization_id, denomination_type, denomination_from, denomination_to, quantity_from, quantity_to,
                   charge_type, charge, is_active, created_at, updated_at
            FROM organization_estamp_bulk_pricing_rule
            WHERE organization_id = %s
            ORDER BY denomination_from ASC, quantity_from ASC
            """,
            (organization_id,),
        ).fetchall()


@router.post("/{organization_id}/estamp-bulk-pricing-rules", status_code=201)
def create_bulk_estamp_pricing_rule(organization_id: UUID, payload: BulkEstampPricingRuleIn) -> dict[str, Any]:
    with get_transaction() as connection:
        _require_organization(connection, organization_id)
        _check_no_overlap(connection, organization_id, payload.model_dump(), exclude_rule_id=None)
        return connection.execute(
            """
            INSERT INTO organization_estamp_bulk_pricing_rule
                (organization_id, denomination_type, denomination_from, denomination_to, quantity_from, quantity_to, charge_type, charge, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, organization_id, denomination_type, denomination_from, denomination_to, quantity_from, quantity_to,
                      charge_type, charge, is_active, created_at, updated_at
            """,
            (
                organization_id, payload.denomination_type, payload.denomination_from, payload.denomination_to,
                payload.quantity_from, payload.quantity_to, payload.charge_type, payload.charge, payload.is_active,
            ),
        ).fetchone()


@router.patch("/{organization_id}/estamp-bulk-pricing-rules/{rule_id}")
def update_bulk_estamp_pricing_rule(
    organization_id: UUID, rule_id: UUID, payload: BulkEstampPricingRuleIn
) -> dict[str, Any]:
    with get_transaction() as connection:
        _require_organization(connection, organization_id)
        existing = connection.execute(
            "SELECT id FROM organization_estamp_bulk_pricing_rule WHERE id = %s AND organization_id = %s",
            (rule_id, organization_id),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Pricing rule not found")
        _check_no_overlap(connection, organization_id, payload.model_dump(), exclude_rule_id=rule_id)
        return connection.execute(
            """
            UPDATE organization_estamp_bulk_pricing_rule
            SET denomination_type = %s, denomination_from = %s, denomination_to = %s, quantity_from = %s, quantity_to = %s,
                charge_type = %s, charge = %s, is_active = %s, updated_at = now()
            WHERE id = %s
            RETURNING id, organization_id, denomination_type, denomination_from, denomination_to, quantity_from, quantity_to,
                      charge_type, charge, is_active, created_at, updated_at
            """,
            (
                payload.denomination_type, payload.denomination_from, payload.denomination_to,
                payload.quantity_from, payload.quantity_to,
                payload.charge_type, payload.charge, payload.is_active, rule_id,
            ),
        ).fetchone()


@router.delete("/{organization_id}/estamp-bulk-pricing-rules/{rule_id}")
def delete_bulk_estamp_pricing_rule(organization_id: UUID, rule_id: UUID) -> dict[str, str]:
    with get_transaction() as connection:
        deleted = connection.execute(
            "DELETE FROM organization_estamp_bulk_pricing_rule WHERE id = %s AND organization_id = %s RETURNING id",
            (rule_id, organization_id),
        ).fetchone()
    if not deleted:
        raise HTTPException(status_code=404, detail="Pricing rule not found")
    return {"message": "Pricing rule deleted successfully"}


# =========================================
# Partner Profile Summary (360° view) — read-only endpoints.
# "Customers" and "Documents" below are synthesized from the `orders` table,
# since this app has no separate customer or generated-document-instance
# entity for B2B partners — each order carries its own free-text customer
# fields and, optionally, one uploaded document.
# =========================================


@router.get("/{organization_id}/customers")
def get_organization_customers(organization_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        _require_organization(connection, organization_id)
        return connection.execute(
            """
            SELECT
                customer_name,
                customer_email,
                customer_mobile,
                COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE document_filename IS NOT NULL)::int AS total_documents,
                MAX(created_at) AS last_order_at
            FROM orders
            WHERE organization_id = %s
            GROUP BY customer_name, customer_email, customer_mobile
            ORDER BY last_order_at DESC
            """,
            (organization_id,),
        ).fetchall()


@router.get("/{organization_id}/documents")
def get_organization_documents(organization_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        _require_organization(connection, organization_id)
        return connection.execute(
            """
            SELECT id, order_no, customer_name, document_filename, service_name, status, created_at, updated_at
            FROM orders
            WHERE organization_id = %s AND document_filename IS NOT NULL
            ORDER BY created_at DESC
            """,
            (organization_id,),
        ).fetchall()


@router.get("/{organization_id}/orders/{order_id}/document")
def download_organization_order_document(organization_id: UUID, order_id: UUID) -> FileResponse:
    with get_connection() as connection:
        order = connection.execute(
            "SELECT document_path, document_filename FROM orders WHERE id = %s AND organization_id = %s",
            (order_id, organization_id),
        ).fetchone()
    if not order or not order["document_path"]:
        raise HTTPException(status_code=404, detail="Document not found")

    upload_dir = Path(__file__).resolve().parents[2] / "uploads" / "orders"
    file_path = upload_dir / order["document_path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file is missing on the server")

    return FileResponse(
        path=str(file_path),
        filename=order["document_filename"] or "document",
        media_type="application/octet-stream",
    )


@router.get("/{organization_id}/revenue")
def get_organization_revenue(organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _require_organization(connection, organization_id)

        totals = connection.execute(
            """
            SELECT
                COALESCE(SUM(amount) FILTER (WHERE status = %(completed)s), 0) AS total_revenue,
                COALESCE(SUM(amount) FILTER (
                    WHERE status = %(completed)s AND created_at >= date_trunc('month', CURRENT_DATE)
                ), 0) AS this_month_revenue,
                COALESCE(SUM(amount) FILTER (
                    WHERE status = %(completed)s AND created_at::date = CURRENT_DATE
                ), 0) AS today_revenue
            FROM orders
            WHERE organization_id = %(organization_id)s
            """,
            {"organization_id": organization_id, "completed": STATUS_COMPLETED},
        ).fetchone()

        by_service = connection.execute(
            """
            SELECT service_name, COALESCE(SUM(amount), 0) AS revenue
            FROM orders
            WHERE organization_id = %(organization_id)s AND status = %(completed)s
            GROUP BY service_name
            ORDER BY revenue DESC
            """,
            {"organization_id": organization_id, "completed": STATUS_COMPLETED},
        ).fetchall()

    return {**totals, "by_service": by_service}


@router.get("/{organization_id}/timeline")
def get_organization_timeline(organization_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 200))
    with get_connection() as connection:
        _require_organization(connection, organization_id)

        rows = connection.execute(
            """
            SELECT 'Partner Created' AS action, organization_name AS label, created_at
            FROM organizations WHERE id = %(organization_id)s

            UNION ALL
            SELECT 'User Added' AS action, u.full_name AS label, ou.created_at
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            WHERE ou.organization_id = %(organization_id)s

            UNION ALL
            SELECT 'Service Pricing Updated' AS action, h.service_name AS label, h.effective_from AS created_at
            FROM organization_service_price_history h
            WHERE h.organization_id = %(organization_id)s

            UNION ALL
            SELECT 'Order Placed' AS action, o.order_no AS label, o.created_at
            FROM orders o
            WHERE o.organization_id = %(organization_id)s

            UNION ALL
            SELECT 'Order Completed' AS action, o.order_no AS label, o.updated_at AS created_at
            FROM orders o
            WHERE o.organization_id = %(organization_id)s AND o.status = %(completed)s

            UNION ALL
            SELECT
                CASE WHEN wt.type = 'credit' THEN 'Wallet Credited' ELSE 'Wallet Debited' END AS action,
                COALESCE(wt.description, '') AS label,
                wt.created_at
            FROM wallet_transactions wt
            WHERE wt.organization_id = %(organization_id)s

            ORDER BY created_at DESC
            LIMIT %(limit)s
            """,
            {"organization_id": organization_id, "completed": STATUS_COMPLETED, "limit": limit},
        ).fetchall()

    return rows
