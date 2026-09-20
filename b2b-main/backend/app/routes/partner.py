import io
import json
import logging
import os
import re
import secrets
import shutil
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import BaseModel, EmailStr, TypeAdapter, ValidationError, field_validator, model_validator
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from app.auth import get_current_partner
from app.database import get_connection, get_transaction
from app.digilocker_service import fetch_aadhaar_details, get_digilocker_status, initiate_digilocker
from app.ekyc_service import get_ekyc_status, initiate_ekyc
from app.email_service import send_password_reset_email
from app.esign_service import SignerIn, get_signed_file_path, initiate_esign
from app.notification_service import (
    notify_insufficient_balance,
    notify_new_order,
    notify_order_completed,
    notify_wallet_deducted,
)
from app.pan_service import get_pan_status
from app.routes.article_codes import get_active_article_codes
from app.routes.catalog import STAMP_PAPER_TYPE_ESTAMP, STAMP_PAPER_TYPE_TRADITIONAL
from app.routes.document_service import list_configured_documents_summary
from app.routes.organizations import (
    RETAILER_CATEGORIES,
    auto_grant_active_org_services,
    get_organization_charge_pricing,
    get_organization_service_charge_pricing,
    list_bulk_estamp_pricing_rules,
)
from app.routes.reports import get_sbtr_challan_reports
from app.routes.services import get_active_service_names
from app.validators import (
    PDF_REQUIRED_SERVICES,
    detect_ekyc_upload_kind,
    is_valid_pdf_bytes,
    pdf_contains_dangerous_content,
    safe_stored_filename_for_kind,
    safe_stored_pdf_filename,
    validate_mobile,
    validate_safe_pdf_bytes,
)

logger = logging.getLogger(__name__)

router = APIRouter()

ORDER_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "orders"


def _order_upload_dir() -> Path:
    ORDER_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return ORDER_UPLOAD_DIR


def _pdf_inline_response(file_path: Path, *, require_safe_content: bool = True) -> FileResponse:
    """Serve a file as an inline PDF only when content is a real PDF.

    Preview endpoints previously always set application/pdf, which let a
    spoofed HTML/JS upload execute in the viewer's browser when opened under
    My Orders. Reject non-PDF files instead of rendering them.

    require_safe_content=True also rejects embedded scripts (user uploads).
    Signed/stamped copies from SignDesk only get a magic-byte check so we
    don't false-positive on vendor PDF features.
    """
    try:
        if require_safe_content:
            validate_safe_pdf_bytes(file_path.read_bytes())
        else:
            with open(file_path, "rb") as f:
                header = f.read(5)
            if not is_valid_pdf_bytes(header):
                raise ValueError("Document is not a valid PDF file")
    except OSError as e:
        raise HTTPException(status_code=404, detail="Document file is missing on the server") from e
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e)) from e
    return FileResponse(str(file_path), media_type="application/pdf", headers={"Content-Disposition": "inline"})


# Tiny request bodies for the Partner Portal's own eSign/eKYC follow-on
# endpoints below — duplicated from partner_user.py's identical classes
# rather than imported from there, since partner_user.py already imports
# from this module (importing back would be circular).
class EsignInitiateRequest(BaseModel):
    signers: list[SignerIn]


class EkycVerifyRequest(BaseModel):
    verification: bool = True


# Duplicated from partner_user.py's identical classes for the same
# circular-import reason as EsignInitiateRequest/EkycVerifyRequest above.
class ManualEstampSignerIn(BaseModel):
    name: str
    # Optional, same as esign_service.SignerIn.email — a signer with no
    # email gets the signing invitation via SMS instead (signer_email of ""
    # plus trigger_esign_request_invitation: "sms", see signdesk_esign.py).
    # This was still EmailStr (mandatory) here, forcing every Manual eStamp
    # signer through email delivery even when SMS-only was intended.
    email: EmailStr | None = None
    mobile: str


class ManualEstampDeliveryAddressIn(BaseModel):
    full_name: str
    mobile: str
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    pincode: str


# Duplicated from partner_user.py's identical classes for the same
# circular-import reason as EsignInitiateRequest/EkycVerifyRequest above.
class BulkEstampItemIn(BaseModel):
    stamp_denomination_id: UUID | None = None
    stamp_value: float | None = None
    quantity: int

    @model_validator(mode="after")
    def _require_denomination_or_value(self) -> "BulkEstampItemIn":
        if not self.stamp_denomination_id and self.stamp_value is None:
            raise ValueError("Either stamp_denomination_id or stamp_value is required")
        if self.stamp_value is not None and self.stamp_value <= 0:
            raise ValueError("stamp_value must be greater than 0")
        return self


class BulkEstampDeliveryAddressIn(BaseModel):
    full_name: str
    mobile: str
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    pincode: str


class BulkEstampPartyDetailsIn(BaseModel):
    partner_party: Literal["first", "second"] = "first"
    paying_party: Literal["first", "second"] = "first"
    other_party_name: str
    other_party_address: str

    @field_validator("other_party_name", "other_party_address")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("This field is required")
        return v


class BulkEstampOrderCreate(BaseModel):
    customer_name: str | None = None
    customer_email: EmailStr | None = None
    customer_mobile: str | None = None
    stamp_state_id: UUID
    items: list[BulkEstampItemIn] = []
    consideration_amount: float | None = None
    article_code_id: UUID | None = None
    delivery_address: BulkEstampDeliveryAddressIn
    party_details: BulkEstampPartyDetailsIn
    # Partner-only addition — optionally attribute the order to one of the
    # partner's own organization_users, same "Created For (Optional)" pattern
    # as create_manual_estamp_order (None = org-wide, no specific user).
    organization_user_id: UUID | None = None


class PartnerUserCreate(BaseModel):
    full_name: str
    email: EmailStr
    mobile: str
    is_active: bool = True

    _validate_mobile = field_validator("mobile")(validate_mobile)


class PartnerUserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    is_active: bool | None = None

    _validate_mobile = field_validator("mobile")(validate_mobile)


class WalletCreditCreate(BaseModel):
    amount: float
    description: str | None = None


class PartnerUserServicesUpdate(BaseModel):
    service_pricing_ids: list[int] = []
    document_config_ids: list[UUID] = []


def _send_reset_email(*, membership_id: UUID, user_id: UUID, email: str, full_name: str) -> dict[str, Any]:
    with get_transaction() as connection:
        token = secrets.token_urlsafe(32)
        connection.execute(
            """
            UPDATE users
            SET password_reset_token = %s, password_reset_expires_at = now() + interval '24 hours'
            WHERE id = %s
            """,
            (token, user_id),
        )

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    reset_link = f"{frontend_url}/set-password/{token}"
    mail_sent = False
    mail_error: str | None = None
    try:
        send_password_reset_email(to_email=email, full_name=full_name or "", reset_link=reset_link)
        mail_sent = True
    except Exception as e:
        mail_error = str(e)

    return {"mail_sent": mail_sent, "mail_error": mail_error, "reset_link": reset_link}


@router.get("/profile")
def get_partner_profile(current_partner: dict[str, Any] = Depends(get_current_partner)) -> dict[str, Any]:
    # Registered-address fields captured at onboarding (see CustomerOnboard.jsx)
    # — same fields partner_user.get_partner_user_profile already exposes,
    # needed here too to prefill "Same as registered address" on the Partner
    # Portal's own eStamp Bulk create-order form.
    from app.organization_state import get_organization_state

    with get_connection() as connection:
        org = connection.execute(
            "SELECT address_line1, address_line2, city, pincode, contact_person, mobile "
            "FROM organizations WHERE id = %s",
            (current_partner["organization_id"],),
        ).fetchone()
    state = get_organization_state(current_partner["organization_id"])

    return {
        "organization_id": current_partner["organization_id"],
        "organization_name": current_partner["organization_name"],
        "organization_type": current_partner["organization_type"],
        "payment_mode": current_partner["payment_mode"],
        "state_id": state["state_id"] if state else None,
        "state_name": state["state_name"] if state else None,
        "registered_address_line1": org["address_line1"] if org else None,
        "registered_address_line2": org["address_line2"] if org else None,
        "registered_city": org["city"] if org else None,
        "registered_pincode": org["pincode"] if org else None,
        "contact_person": org["contact_person"] if org else None,
        "org_mobile": org["mobile"] if org else None,
    }


# =========================================
# DEALER -> RETAILER MANAGEMENT
# Only Dealer-type partners can onboard/view their own Retailers. All
# retailers created here are scoped under this dealer (dealer_id).
# =========================================


class RetailerCreate(BaseModel):
    organization_name: str
    retailer_category: str
    contact_person: str | None = None
    email: EmailStr
    mobile: str | None = None
    state_id: UUID | None = None
    gst_number: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    pincode: str | None = None
    payment_mode: str = "Wallet"

    _validate_mobile = field_validator("mobile")(validate_mobile)


def _require_dealer(current_partner: dict[str, Any]) -> None:
    if current_partner["organization_type"] != "Dealer":
        raise HTTPException(status_code=403, detail="Only Dealer partners can manage retailers")


@router.get("/retailers")
def list_partner_retailers(current_partner: dict[str, Any] = Depends(get_current_partner)) -> list[dict[str, Any]]:
    _require_dealer(current_partner)
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT
                o.id, o.organization_name, o.retailer_category, o.payment_mode,
                o.contact_person, o.email, o.mobile, o.state_id, s.state_name,
                o.gst_number, o.address_line1, o.address_line2, o.city, o.pincode, o.is_active, o.created_at
            FROM organizations o
            LEFT JOIN state s ON s.id = o.state_id
            WHERE o.dealer_id = %s
            ORDER BY o.created_at DESC
            """,
            (current_partner["organization_id"],),
        ).fetchall()


@router.post("/retailers", status_code=201)
def create_partner_retailer(
    payload: RetailerCreate,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    _require_dealer(current_partner)
    if payload.retailer_category not in RETAILER_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"retailer_category must be one of {RETAILER_CATEGORIES}")
    if payload.payment_mode not in ("Wallet", "PPS"):
        raise HTTPException(status_code=400, detail="payment_mode must be 'Wallet' or 'PPS'")

    data = payload.model_dump()
    data["dealer_id"] = current_partner["organization_id"]

    sql = """
        INSERT INTO organizations (
            organization_name, organization_type, retailer_category, payment_mode, dealer_id,
            contact_person, email, mobile, state_id, gst_number,
            address_line1, address_line2, city, pincode, is_active
        )
        VALUES (
            %(organization_name)s, 'Retailer', %(retailer_category)s, %(payment_mode)s, %(dealer_id)s,
            %(contact_person)s, %(email)s, %(mobile)s, %(state_id)s, %(gst_number)s,
            %(address_line1)s, %(address_line2)s, %(city)s, %(pincode)s, true
        )
        RETURNING
            id, organization_name, retailer_category, payment_mode, dealer_id,
            contact_person, email, mobile, state_id, gst_number,
            address_line1, address_line2, city, pincode, is_active, created_at
    """
    with get_connection() as connection:
        try:
            return connection.execute(sql, data).fetchone()
        except UniqueViolation:
            raise HTTPException(status_code=409, detail=f"An organization with email '{payload.email}' already exists")


@router.get("/users")
def list_partner_users(current_partner: dict[str, Any] = Depends(get_current_partner)) -> list[dict[str, Any]]:
    sql = """
        SELECT
            ou.id,
            ou.organization_id,
            ou.user_id,
            ou.is_active,
            ou.mobile,
            ou.created_at,
            u.full_name,
            u.email,
            COALESCE(w.balance, 0) AS wallet_balance
        FROM organization_users ou
        JOIN users u ON u.id = ou.user_id
        LEFT JOIN organization_user_wallet w ON w.organization_user_id = ou.id
        WHERE ou.organization_id = %s
        ORDER BY ou.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, (current_partner["organization_id"],)).fetchall()


@router.post("/users", status_code=201)
def create_partner_user(
    payload: PartnerUserCreate,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]

    with get_transaction() as connection:
        # `users.email` is a single global login identity shared across Super
        # Admin, every partner org, etc. — it is NOT scoped per organization.
        # So finding a match here only means "this person already has an
        # account somewhere"; it does not mean they're one of *this* partner's
        # users. Link the existing identity to this org instead of rejecting
        # it (mirrors organizations.create_or_link_organization_user, the
        # Super Admin equivalent of this same flow) and only block when
        # they're already a member of this specific organization.
        existing_user = connection.execute(
            "SELECT id, password_hash FROM users WHERE lower(email) = lower(%s)",
            (str(payload.email),),
        ).fetchone()

        if existing_user:
            user_id = existing_user["id"]

            already_member = connection.execute(
                "SELECT id FROM organization_users WHERE organization_id = %s AND user_id = %s",
                (organization_id, user_id),
            ).fetchone()
            if already_member:
                raise HTTPException(
                    status_code=409,
                    detail=f"'{payload.email}' is already a user in your organization",
                )

            connection.execute(
                """
                UPDATE users
                SET full_name = COALESCE(NULLIF(%s, ''), full_name), modified_at = now()
                WHERE id = %s
                """,
                (payload.full_name, user_id),
            )
        else:
            try:
                user = connection.execute(
                    """
                    INSERT INTO users (id, email, password_hash, full_name, is_active, created_at, created_by, role)
                    VALUES (gen_random_uuid(), %s, 'pending_invite', %s, %s, now(), %s, 'member')
                    RETURNING id
                    """,
                    (str(payload.email), payload.full_name, payload.is_active, current_partner["id"]),
                ).fetchone()
            except UniqueViolation:
                raise HTTPException(status_code=409, detail=f"A user with email '{payload.email}' already exists")
            user_id = user["id"]

        membership = connection.execute(
            """
            INSERT INTO organization_users (organization_id, user_id, role, is_active, mobile)
            VALUES (%s, %s, 'member', %s, %s)
            RETURNING id, organization_id, user_id, is_active, mobile, created_at
            """,
            (organization_id, user_id, payload.is_active, payload.mobile),
        ).fetchone()

        connection.execute(
            """
            INSERT INTO organization_user_wallet (organization_user_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_user_id) DO NOTHING
            """,
            (membership["id"],),
        )

        auto_grant_active_org_services(connection, organization_id, membership["id"])

    return {
        **membership,
        "full_name": payload.full_name,
        "email": str(payload.email),
        "wallet_balance": 0,
    }


def _get_partner_user(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                ou.id,
                ou.organization_id,
                ou.user_id,
                ou.is_active,
                ou.mobile,
                ou.created_at,
                u.full_name,
                u.email,
                COALESCE(w.balance, 0) AS wallet_balance
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            LEFT JOIN organization_user_wallet w ON w.organization_user_id = ou.id
            WHERE ou.organization_id = %s AND ou.id = %s
            """,
            (organization_id, membership_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row


@router.get("/users/{membership_id}")
def get_partner_user(
    membership_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    row = _get_partner_user(current_partner["organization_id"], membership_id)
    with get_connection() as connection:
        stats = connection.execute(
            """
            SELECT
                COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed_orders,
                COUNT(*) FILTER (WHERE status IN ('Draft', 'Submitted', 'In Progress'))::int AS pending_orders
            FROM orders
            WHERE organization_user_id = %s
            """,
            (membership_id,),
        ).fetchone()
    return {
        **row,
        **stats,
    }


@router.patch("/users/{membership_id}")
def update_partner_user(
    membership_id: UUID,
    payload: PartnerUserUpdate,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    organization_id = current_partner["organization_id"]

    with get_transaction() as connection:
        membership = connection.execute(
            "SELECT id, user_id FROM organization_users WHERE organization_id = %s AND id = %s",
            (organization_id, membership_id),
        ).fetchone()
        if not membership:
            raise HTTPException(status_code=404, detail="User not found")

        user_fields = {k: v for k, v in data.items() if k in ("full_name", "email")}
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

        membership_fields = {k: v for k, v in data.items() if k in ("mobile", "is_active")}
        if membership_fields:
            assignments = ", ".join(f"{field} = %({field})s" for field in membership_fields)
            membership_fields["membership_id"] = membership_id
            connection.execute(
                f"UPDATE organization_users SET {assignments} WHERE id = %(membership_id)s",
                membership_fields,
            )

    return get_partner_user(membership_id, current_partner)


@router.post("/users/{membership_id}/reset-password")
def reset_partner_user_password(
    membership_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]

    with get_connection() as connection:
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

    return _send_reset_email(
        membership_id=membership["id"],
        user_id=membership["user_id"],
        email=membership["email"],
        full_name=membership["full_name"],
    )


@router.get("/users/{membership_id}/services")
def list_partner_user_services(
    membership_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]
    _get_partner_user(organization_id, membership_id)  # 404s if not this partner's user

    with get_connection() as connection:
        services = connection.execute(
            """
            SELECT
                sp.id AS service_pricing_id,
                sp.service_name,
                sp.price,
                (pus.id IS NOT NULL) AS assigned
            FROM organization_service_pricing sp
            LEFT JOIN partner_user_services pus
                ON pus.service_pricing_id = sp.id AND pus.organization_user_id = %(membership_id)s
            WHERE sp.organization_id = %(organization_id)s
                AND sp.is_active = true
                AND sp.service_name != 'Document Service'
            ORDER BY sp.service_name ASC
            """,
            {"organization_id": organization_id, "membership_id": membership_id},
        ).fetchall()

        documents = connection.execute(
            """
            SELECT
                odc.id AS document_config_id,
                d.doc_id,
                d.doc_name,
                c.category_name,
                odc.state_id,
                s.state_name,
                odc.base_price,
                odc.available_languages,
                (pus.id IS NOT NULL) AS assigned
            FROM organization_document_config odc
            JOIN document d ON d.doc_id = odc.doc_id
            LEFT JOIN category c ON c.category_id = d.category_id
            LEFT JOIN state s ON s.id = odc.state_id
            LEFT JOIN partner_user_services pus
                ON pus.document_config_id = odc.id AND pus.organization_user_id = %(membership_id)s
            WHERE odc.organization_id = %(organization_id)s AND odc.status = true
            ORDER BY d.doc_name ASC
            """,
            {"organization_id": organization_id, "membership_id": membership_id},
        ).fetchall()

    return {"services": services, "documents": documents}


@router.put("/users/{membership_id}/services")
def update_partner_user_services(
    membership_id: UUID,
    payload: PartnerUserServicesUpdate,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]
    _get_partner_user(organization_id, membership_id)  # 404s if not this partner's user

    with get_transaction() as connection:
        # Only ever assign services/documents this partner was actually given
        # by Super Admin — ids outside that set are silently dropped rather
        # than trusted from the client, so a partner can never grant a user
        # access to something they don't themselves own.
        valid_service_ids: set[int] = set()
        if payload.service_pricing_ids:
            valid_service_ids = {
                row["id"]
                for row in connection.execute(
                    """
                    SELECT id FROM organization_service_pricing
                    WHERE organization_id = %s AND is_active = true AND service_name != 'Document Service'
                        AND id = ANY(%s)
                    """,
                    (organization_id, list(payload.service_pricing_ids)),
                ).fetchall()
            }

        valid_document_ids: set[UUID] = set()
        if payload.document_config_ids:
            valid_document_ids = {
                row["id"]
                for row in connection.execute(
                    """
                    SELECT id FROM organization_document_config
                    WHERE organization_id = %s AND status = true AND id = ANY(%s)
                    """,
                    (organization_id, list(payload.document_config_ids)),
                ).fetchall()
            }

        connection.execute(
            "DELETE FROM partner_user_services WHERE organization_user_id = %s",
            (membership_id,),
        )
        for service_id in valid_service_ids:
            connection.execute(
                "INSERT INTO partner_user_services (organization_user_id, service_pricing_id) VALUES (%s, %s)",
                (membership_id, service_id),
            )
        for document_id in valid_document_ids:
            connection.execute(
                "INSERT INTO partner_user_services (organization_user_id, document_config_id) VALUES (%s, %s)",
                (membership_id, document_id),
            )

    return list_partner_user_services(membership_id, current_partner)


# =========================================
# WALLET — My Wallet (read-only), User Wallets (credit), Transactions
# =========================================


@router.get("/wallet")
def get_partner_wallet(current_partner: dict[str, Any] = Depends(get_current_partner)) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]
    with get_connection() as connection:
        wallet = connection.execute(
            "SELECT organization_id, balance, blocked_amount, updated_at FROM organization_wallet WHERE organization_id = %s",
            (organization_id,),
        ).fetchone()
        if not wallet:
            wallet = {"organization_id": organization_id, "balance": 0, "blocked_amount": 0, "updated_at": None}

        transactions = connection.execute(
            """
            SELECT id, organization_id, type, amount, balance_after, description, created_at
            FROM wallet_transactions
            WHERE organization_id = %s
            ORDER BY created_at DESC
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

    available_balance = float(wallet["balance"] or 0) - float(wallet["blocked_amount"] or 0)
    return {**wallet, **totals, "available_balance": available_balance, "transactions": transactions}


@router.get("/wallets/users")
def list_partner_user_wallets(current_partner: dict[str, Any] = Depends(get_current_partner)) -> list[dict[str, Any]]:
    organization_id = current_partner["organization_id"]
    with get_connection() as connection:
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


def _get_partner_user_wallet(organization_id: UUID, membership_id: UUID) -> dict[str, Any]:
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
            SELECT id, organization_user_id, type, amount, balance_after, description, created_at
            FROM organization_user_wallet_transactions
            WHERE organization_user_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (membership_id,),
        ).fetchall()

    return {**membership, **wallet, "transactions": transactions}


@router.get("/users/{membership_id}/wallet")
def get_partner_user_wallet(
    membership_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return _get_partner_user_wallet(current_partner["organization_id"], membership_id)


@router.post("/users/{membership_id}/wallet/credit")
def credit_partner_user_wallet(
    membership_id: UUID,
    payload: WalletCreditCreate,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    organization_id = current_partner["organization_id"]

    with get_transaction() as connection:
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
            raise HTTPException(status_code=400, detail="Insufficient wallet balance")

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
        connection.execute(
            """
            INSERT INTO organization_user_wallet_transactions (organization_user_id, type, amount, balance_after, description)
            VALUES (%s, 'credit', %s, %s, %s)
            """,
            (membership_id, payload.amount, new_user_balance, payload.description),
        )

    return _get_partner_user_wallet(organization_id, membership_id)


@router.get("/wallet/transactions")
def list_partner_wallet_transactions(
    user_id: UUID | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    organization_id = current_partner["organization_id"]
    conditions = ["ou.organization_id = %(organization_id)s", "t.type = 'credit'"]
    params: dict[str, Any] = {"organization_id": organization_id}

    if user_id:
        conditions.append("ou.id = %(user_id)s")
        params["user_id"] = user_id
    if date_from:
        conditions.append("t.created_at >= %(date_from)s")
        params["date_from"] = date_from
    if date_to:
        conditions.append("t.created_at < (%(date_to)s::date + interval '1 day')")
        params["date_to"] = date_to

    sql = f"""
        SELECT
            t.id,
            ou.id AS membership_id,
            u.full_name,
            u.email,
            t.amount,
            t.balance_after,
            t.description,
            t.created_at
        FROM organization_user_wallet_transactions t
        JOIN organization_users ou ON ou.id = t.organization_user_id
        JOIN users u ON u.id = ou.user_id
        WHERE {" AND ".join(conditions)}
        ORDER BY t.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, params).fetchall()


# =========================================
# ORDERS
# =========================================

# Order lifecycle. "In Progress"/"Completed"/"Failed" are set by downstream order
# processing (not yet built) — a partner can only Draft, Submit, or Cancel.
ORDER_STATUSES = ["Draft", "Submitted", "In Progress", "Completed", "Failed", "Cancelled"]
STATUS_DRAFT, STATUS_SUBMITTED, STATUS_IN_PROGRESS, STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED = ORDER_STATUSES


@router.get("/services")
def list_partner_services(current_partner: dict[str, Any] = Depends(get_current_partner)) -> list[dict[str, Any]]:
    organization_id = current_partner["organization_id"]
    with get_connection() as connection:
        rows = {
            row["service_name"]: row
            for row in connection.execute(
                "SELECT service_name, is_active, price FROM organization_service_pricing WHERE organization_id = %s",
                (organization_id,),
            ).fetchall()
        }
    return [
        {
            "service_name": name,
            "is_active": rows.get(name, {}).get("is_active", False),
            "price": rows.get(name, {}).get("price"),
        }
        for name in get_active_service_names()
    ]


@router.get("/services/documents")
def list_partner_document_services(
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    # organization_id is forced to the logged-in partner's own org — never
    # client-supplied. Reuses the same summary the Super Admin's Partner List
    # "View Services" modal already shows (returns [] if Document Service
    # isn't enabled for this partner).
    return list_configured_documents_summary(current_partner["organization_id"])


@router.get("/charges")
def list_partner_charges(current_partner: dict[str, Any] = Depends(get_current_partner)) -> dict[str, Any]:
    # Same shape/reasoning as partner_user.list_my_charges — every enabled
    # charge for the org as a whole, org-wide (charges have no per-user
    # assignment table the way services do).
    pricing = get_organization_charge_pricing(current_partner["organization_id"])
    return {"charges": [{"charge_name": c["charge_name"], "price": c["price"]} for c in pricing["charges"] if c["is_active"]]}


@router.get("/services/{service_name}/charges")
def list_partner_service_charges(
    service_name: str, current_partner: dict[str, Any] = Depends(get_current_partner)
) -> dict[str, Any]:
    # Same shape/reasoning as partner_user.list_my_service_charges — a
    # read-only preview of this service's admin-configured additional
    # charges for the Create Order form's Order Summary.
    pricing = get_organization_service_charge_pricing(current_partner["organization_id"])
    return {
        "charges": [
            {
                "charge_name": c["charge_name"],
                "price": c["price"],
                "calculation_type": c["calculation_type"],
                "percentage": c["percentage"],
                "minimum_amount": c["minimum_amount"],
            }
            for c in pricing["charges"]
            if c["service_name"] == service_name and c["is_active"]
        ]
    }


@router.get("/stamp-denominations")
def list_partner_stamp_denominations(
    state_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    # Read-only, not org-scoped — same shared master (b2b_stamp_denomination)
    # and reasoning as partner_user.list_my_stamp_denominations: eStamp Bulk
    # and Manual eStamp both build their denomination pickers from this,
    # gated only by being logged in, same as that member-facing equivalent.
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT id, stamp_value
            FROM b2b_stamp_denomination
            WHERE state_id = %s AND is_active = true
            ORDER BY stamp_value ASC
            """,
            (state_id,),
        ).fetchall()


@router.get("/orders")
def list_partner_orders(
    status: str | None = None,
    organization_user_id: UUID | None = None,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    organization_id = current_partner["organization_id"]
    conditions = ["o.organization_id = %(organization_id)s"]
    params: dict[str, Any] = {"organization_id": organization_id}

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        conditions.append("o.status = ANY(%(statuses)s)")
        params["statuses"] = statuses

    # Used by the Partner User portal to scope the list to their own orders —
    # always the caller's own id there, never client-chosen.
    if organization_user_id:
        conditions.append("o.organization_user_id = %(organization_user_id)s")
        params["organization_user_id"] = organization_user_id

    sql = f"""
        SELECT
            o.id, o.order_no, o.organization_id, o.organization_user_id, o.customer_name, o.customer_email,
            o.customer_mobile, o.service_name, o.document_filename, o.amount, o.quantity, o.status, o.created_at, o.updated_at,
            o.esign_price_per_signer, es.signers AS esign_signers, es.latest_status AS esign_latest_status
        FROM orders o
        LEFT JOIN LATERAL (
            SELECT
                t.status AS latest_status,
                (
                    SELECT json_agg(
                        json_build_object(
                            'name', s.signer_name, 'status', s.status,
                            'sequence', s.sequence, 'signed_at', s.signed_at
                        ) ORDER BY s.sequence NULLS LAST, s.created_at
                    )
                    FROM b2b_esign_signer s WHERE s.transaction_id = t.id
                ) AS signers
            FROM b2b_esign_transaction t
            WHERE t.order_id = o.id
            ORDER BY t.version DESC
            LIMIT 1
        -- eStamp/Manual eStamp orders can also pick up a follow-on eSign
        -- workflow (see esign_service.initiate_esign) — included here too so
        -- their signer timeline/status show up in the list the same way a
        -- native eSign order's does. An order with no such workflow just
        -- gets NULLs from this join, same as before.
        ) es ON o.service_name IN ('eSign', 'eStamp', 'Manual eStamp')
        WHERE {" AND ".join(conditions)}
        ORDER BY o.created_at DESC
    """
    with get_connection() as connection:
        rows = connection.execute(sql, params).fetchall()

        # Fetch and append drafts if "Draft" is in statuses or status is not filtered
        if not status or "Draft" in [s.strip() for s in status.split(",")]:
            draft_conditions = [c.replace("o.", "") for c in conditions if "o.status" not in c]
            drafts = connection.execute(f"""
                SELECT id, organization_id, organization_user_id, document_name AS service_name,
                       form_state, updated_at AS created_at, updated_at
                FROM loan_application_drafts
                WHERE {" AND ".join(draft_conditions)}
            """, params).fetchall()

            for d in drafts:
                customer_name = "Draft (Incomplete)"
                customer_email = None
                customer_mobile = None
                try:
                    parties = d["form_state"].get("parties", [])
                    if parties:
                        customer_name = parties[0].get("name") or "Draft (Incomplete)"
                        customer_email = parties[0].get("email")
                        customer_mobile = parties[0].get("mobile")
                except Exception:
                    pass
                
                rows.append({
                    "id": d["id"],
                    "order_no": f"DRAFT-{str(d['id'])[:8].upper()}",
                    "organization_id": d["organization_id"],
                    "organization_user_id": d["organization_user_id"],
                    "customer_name": customer_name,
                    "customer_email": customer_email,
                    "customer_mobile": customer_mobile,
                    "service_name": d["service_name"],
                    "document_filename": None,
                    "amount": 0.0,
                    "quantity": 1,
                    "status": "Draft",
                    "created_at": d["created_at"],
                    "updated_at": d["updated_at"],
                    "esign_price_per_signer": None,
                    "esign_signers": None,
                    "esign_latest_status": None,
                })

            rows.sort(key=lambda r: r["created_at"], reverse=True)

    for row in rows:
        if row["service_name"] in ("eSign", "eStamp", "Manual eStamp"):
            signers = row.get("esign_signers") or []
            # Actual completed-signer count from the DB, not the overall
            # workflow status label — matches exactly what the wallet has
            # actually debited so far (see esign_service.record_callback,
            # which bills per signer on their individual 'signed' transition).
            signed = sum(1 for s in signers if s["status"] == "signed")
            row["esign_status_label"] = _esign_status_label(
                transaction_status=row.pop("esign_latest_status"), signed=signed, total=len(signers),
            )
            price_per_signer = _effective_esign_price_per_signer(
                esign_price_per_signer=row.pop("esign_price_per_signer"), amount=row["amount"], quantity=row["quantity"],
            )
            row["charged_amount"] = round(price_per_signer * signed, 2)
        else:
            row.pop("esign_latest_status", None)
            row.pop("esign_price_per_signer", None)

    return rows


def _effective_esign_price_per_signer(*, esign_price_per_signer, amount, quantity) -> float:
    """Same fallback used by the actual per-signature billing in
    esign_service.record_callback — orders created before the
    esign_price_per_signer column existed have it as NULL, so the Charged
    Amount display must fall back to amount/quantity exactly like the real
    debit does, or older orders would show ₹0 charged even though the wallet
    was genuinely billed for every signature that completed."""
    if esign_price_per_signer is not None:
        return float(esign_price_per_signer)
    return float(amount) / quantity if quantity else float(amount)


def _esign_status_label(*, transaction_status: str | None, signed: int, total: int) -> str | None:
    """Derives the label shown in place of the raw order.status ("Submitted")
    for eSign orders, so the Status badge never contradicts the per-signer
    timeline next to it. None means eSign was never initiated for this order
    — the caller falls back to the plain order status in that case."""
    if transaction_status is None:
        return None
    return {
        "signed": "Completed",
        "rejected": "Rejected",
        "expired": "Expired",
        "failed": "Failed",
        "cancelled": "Cancelled",
    }.get(transaction_status, "Partially Signed" if signed > 0 else "Sent for Signature")


def _debit_wallet(
    connection,
    *,
    organization_id: UUID,
    organization_user_id: UUID | None,
    amount: float,
    description: str,
    order_id: UUID | None = None,
    allow_negative: bool = False,
) -> float:
    # Debits the member's own wallet when the order was placed for a specific
    # organization_user (Partner User self-service, or a Partner ordering on
    # behalf of one of their users); otherwise debits the organization's own
    # wallet (a Partner/Dealer ordering directly, with no user attached).
    # FOR UPDATE locks the row so concurrent orders can't both read the same
    # starting balance and overdraw the wallet.
    if organization_user_id is not None:
        connection.execute(
            """
            INSERT INTO organization_user_wallet (organization_user_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_user_id) DO NOTHING
            """,
            (organization_user_id,),
        )
        wallet = connection.execute(
            "SELECT balance FROM organization_user_wallet WHERE organization_user_id = %s FOR UPDATE",
            (organization_user_id,),
        ).fetchone()
    else:
        connection.execute(
            """
            INSERT INTO organization_wallet (organization_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_id) DO NOTHING
            """,
            (organization_id,),
        )
        wallet = connection.execute(
            "SELECT balance FROM organization_wallet WHERE organization_id = %s FOR UPDATE",
            (organization_id,),
        ).fetchone()

    available = float(wallet["balance"])
    new_balance = available - amount
    if new_balance < 0 and not allow_negative:
        notify_insufficient_balance(
            organization_id=organization_id, organization_user_id=organization_user_id,
            amount=amount, available=available,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient wallet balance. This order costs ₹{amount:,.2f} but only ₹{available:,.2f} is available in your wallet.",
        )

    if organization_user_id is not None:
        connection.execute(
            "UPDATE organization_user_wallet SET balance = %s, updated_at = now() WHERE organization_user_id = %s",
            (new_balance, organization_user_id),
        )
        connection.execute(
            """
            INSERT INTO organization_user_wallet_transactions (organization_user_id, type, amount, balance_after, description, order_id)
            VALUES (%s, 'debit', %s, %s, %s, %s)
            """,
            (organization_user_id, amount, new_balance, description, order_id),
        )
    else:
        connection.execute(
            "UPDATE organization_wallet SET balance = %s, updated_at = now() WHERE organization_id = %s",
            (new_balance, organization_id),
        )
        connection.execute(
            """
            INSERT INTO wallet_transactions (organization_id, type, amount, balance_after, description, order_id)
            VALUES (%s, 'debit', %s, %s, %s, %s)
            """,
            (organization_id, amount, new_balance, description, order_id),
        )

    notify_wallet_deducted(
        organization_id=organization_id, organization_user_id=organization_user_id,
        amount=amount, description=description,
    )
    return new_balance


# The only two columns _block_wallet_amount/_release_wallet_block are ever
# allowed to write to — wallet_blocked_amount (eStamp/Manual eStamp stamp-
# duty face value) and esign_wallet_blocked_amount (eSign, tracked
# completely independently so a combo order — eSign attached to a stamp
# order — can reserve for BOTH purposes at once without either clobbering
# the other's bookkeeping). Column names are never user input, but this
# allow-list is still checked before any f-string interpolation below, on
# principle.
_VALID_ORDER_BLOCK_COLUMNS = {"wallet_blocked_amount", "esign_wallet_blocked_amount"}


def _block_wallet_amount(
    connection,
    *,
    organization_id: UUID,
    organization_user_id: UUID | None,
    amount: float,
    order_id: UUID,
    description: str,
    order_column: str = "wallet_blocked_amount",
) -> None:
    """Reserves `amount` against the wallet's AVAILABLE balance
    (balance - blocked_amount) without moving any real money — no
    wallet_transactions/organization_user_wallet_transactions row is
    inserted, since nothing has actually been credited or debited yet (see
    the schema comment on organization_wallet.blocked_amount). Same
    FOR UPDATE locking as _debit_wallet, so two orders placed concurrently
    against the same wallet can never both reserve money the other already
    has blocked. Raises the same insufficient-balance HTTPException shape
    _debit_wallet raises, just computed against available rather than raw
    balance. Records exactly how much THIS order blocked on
    orders.<order_column> (wallet_blocked_amount by default; eSign passes
    esign_wallet_blocked_amount — see _VALID_ORDER_BLOCK_COLUMNS above), so
    _release_wallet_block/_convert_block_to_debit later know the precise
    figure to reverse.
    """
    assert order_column in _VALID_ORDER_BLOCK_COLUMNS
    if organization_user_id is not None:
        connection.execute(
            """
            INSERT INTO organization_user_wallet (organization_user_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_user_id) DO NOTHING
            """,
            (organization_user_id,),
        )
        wallet = connection.execute(
            "SELECT balance, blocked_amount FROM organization_user_wallet WHERE organization_user_id = %s FOR UPDATE",
            (organization_user_id,),
        ).fetchone()
    else:
        connection.execute(
            """
            INSERT INTO organization_wallet (organization_id, balance)
            VALUES (%s, 0)
            ON CONFLICT (organization_id) DO NOTHING
            """,
            (organization_id,),
        )
        wallet = connection.execute(
            "SELECT balance, blocked_amount FROM organization_wallet WHERE organization_id = %s FOR UPDATE",
            (organization_id,),
        ).fetchone()

    balance = float(wallet["balance"])
    blocked = float(wallet["blocked_amount"])
    available = balance - blocked
    if available < amount:
        notify_insufficient_balance(
            organization_id=organization_id, organization_user_id=organization_user_id,
            amount=amount, available=available,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient wallet balance. This order costs ₹{amount:,.2f} but only ₹{available:,.2f} is available "
                f"(₹{blocked:,.2f} of your ₹{balance:,.2f} balance is currently reserved for other pending orders)."
            ),
        )

    new_blocked = blocked + amount
    if organization_user_id is not None:
        connection.execute(
            "UPDATE organization_user_wallet SET blocked_amount = %s, updated_at = now() WHERE organization_user_id = %s",
            (new_blocked, organization_user_id),
        )
    else:
        connection.execute(
            "UPDATE organization_wallet SET blocked_amount = %s, updated_at = now() WHERE organization_id = %s",
            (new_blocked, organization_id),
        )
    connection.execute(
        f"UPDATE orders SET {order_column} = %s WHERE id = %s",
        (amount, order_id),
    )
    logger.info("Wallet block: %s (order %s, ₹%.2f)", description, order_id, amount)


def _release_wallet_block(
    connection,
    *,
    organization_id: UUID,
    organization_user_id: UUID | None,
    amount: float,
    order_id: UUID,
    order_column: str = "wallet_blocked_amount",
) -> None:
    """Reverses _block_wallet_amount — releases `amount` back to available
    balance whenever a blocked order is cancelled, or its blocked amount
    needs to shrink/be replaced (e.g. add_bulk_estamp_denomination changing
    the face value pre-Completed: release the old amount, then
    _block_wallet_amount the new one). `balance` itself is never touched —
    the amount was never actually moved — so, like _block_wallet_amount, no
    wallet_transactions row is inserted. GREATEST(...,0) floors against
    float rounding drift rather than ever going negative.

    Always clears orders.<order_column> to 0 outright (never a partial
    decrement) — correct for every caller of THIS function: eStamp's
    all-or-nothing reservation, and eSign cancellation, where whatever
    remains in esign_wallet_blocked_amount at cancel time already IS only
    the not-yet-signed signers' share (see _convert_partial_block_to_debit
    below, which peels off each signed signer's share as they go — this
    function is never called with signers still meant to keep their
    reservation).
    """
    assert order_column in _VALID_ORDER_BLOCK_COLUMNS
    if organization_user_id is not None:
        connection.execute(
            "SELECT blocked_amount FROM organization_user_wallet WHERE organization_user_id = %s FOR UPDATE",
            (organization_user_id,),
        )
        connection.execute(
            """
            UPDATE organization_user_wallet
            SET blocked_amount = GREATEST(blocked_amount - %s, 0), updated_at = now()
            WHERE organization_user_id = %s
            """,
            (amount, organization_user_id),
        )
    else:
        connection.execute(
            "SELECT blocked_amount FROM organization_wallet WHERE organization_id = %s FOR UPDATE",
            (organization_id,),
        )
        connection.execute(
            """
            UPDATE organization_wallet
            SET blocked_amount = GREATEST(blocked_amount - %s, 0), updated_at = now()
            WHERE organization_id = %s
            """,
            (amount, organization_id),
        )
    connection.execute(
        f"UPDATE orders SET {order_column} = 0 WHERE id = %s",
        (order_id,),
    )


def _convert_block_to_debit(
    connection,
    *,
    organization_id: UUID,
    organization_user_id: UUID | None,
    amount: float,
    order_id: UUID,
    description: str,
    order_column: str = "wallet_blocked_amount",
) -> float:
    """Converts a block into the real thing, atomically, the moment an
    order with a blocked stamp value reaches Completed: releases the
    reservation, then performs the actual _debit_wallet (unchanged —
    balance decrement + ledger row + notify_wallet_deducted). The amount
    was already confirmed available at block time, so this debit succeeds
    by construction; allow_negative is never needed here.
    """
    _release_wallet_block(
        connection, organization_id=organization_id, organization_user_id=organization_user_id,
        amount=amount, order_id=order_id, order_column=order_column,
    )
    return _debit_wallet(
        connection, organization_id=organization_id, organization_user_id=organization_user_id,
        amount=amount, description=description, order_id=order_id,
    )


def _convert_partial_block_to_debit(
    connection,
    *,
    organization_id: UUID,
    organization_user_id: UUID | None,
    amount: float,
    order_id: UUID,
    description: str,
    order_column: str = "wallet_blocked_amount",
) -> float:
    """Converts exactly `amount` (e.g. one eSign signer's share) from block
    to a real debit, leaving the REST of this order's block untouched —
    genuinely different from _release_wallet_block/_convert_block_to_debit
    above, which always clear an order's entire remaining block in one shot
    (correct for eStamp's all-or-nothing reservation; wrong here, since
    eSign's signers complete independently over time — see
    esign_service.initiate_esign, which blocks price_per_signer x
    len(signers) up front, and esign_service._apply_signer_status, which
    calls this once per signer as each one actually signs).
    """
    assert order_column in _VALID_ORDER_BLOCK_COLUMNS
    if organization_user_id is not None:
        connection.execute(
            "SELECT blocked_amount FROM organization_user_wallet WHERE organization_user_id = %s FOR UPDATE",
            (organization_user_id,),
        )
        connection.execute(
            """
            UPDATE organization_user_wallet
            SET blocked_amount = GREATEST(blocked_amount - %s, 0), updated_at = now()
            WHERE organization_user_id = %s
            """,
            (amount, organization_user_id),
        )
    else:
        connection.execute(
            "SELECT blocked_amount FROM organization_wallet WHERE organization_id = %s FOR UPDATE",
            (organization_id,),
        )
        connection.execute(
            """
            UPDATE organization_wallet
            SET blocked_amount = GREATEST(blocked_amount - %s, 0), updated_at = now()
            WHERE organization_id = %s
            """,
            (amount, organization_id),
        )
    connection.execute(
        f"UPDATE orders SET {order_column} = GREATEST({order_column} - %s, 0) WHERE id = %s",
        (amount, order_id),
    )
    return _debit_wallet(
        connection, organization_id=organization_id, organization_user_id=organization_user_id,
        amount=amount, description=description, order_id=order_id,
    )


def _to_decimal(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _persist_loan_application(connection, order_id: UUID, loan_details: dict[str, Any]) -> None:
    """Normalized mirror of orders.loan_details (see schema.sql's "LOAN
    APPLICATIONS" section) — written alongside the JSONB column, inside the
    same transaction as the orders INSERT in _create_order, so a Loan
    Application order either has both or neither, never one without the
    other. loan_details with no 'parties' list (every non-loan-application
    order — the field is reused generically) is a no-op. Field names below
    match LoanDocumentFlow.jsx's `loan_details` shape / partner_user.py's
    PartyInput and its sub-models 1:1, since both sides of this pipe are
    owned together."""
    parties = loan_details.get("parties") or []
    if not parties:
        return

    application = connection.execute(
        """
        INSERT INTO loan_applications (
            order_id, loan_type_document_name, language, loan_amount, tenure_months,
            interest_rate, repayment_frequency, loan_type_fields, documents_checklist
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            order_id,
            loan_details.get("loan_type"),
            loan_details.get("language"),
            _to_decimal(loan_details.get("loan_amount")),
            _to_int(loan_details.get("tenure_months")),
            _to_decimal(loan_details.get("interest_rate")),
            loan_details.get("repayment_frequency"),
            Jsonb(loan_details.get("loan_type_fields") or {}),
            Jsonb(loan_details.get("documents_checklist") or []),
        ),
    ).fetchone()
    application_id = application["id"]

    for party in parties:
        personal = party.get("personal") or {}
        address = party.get("address") or {}
        employment = party.get("employment") or {}
        party_row = connection.execute(
            """
            INSERT INTO loan_application_parties (
                loan_application_id, role,
                full_name, gender, date_of_birth, marital_status, spouse_name, father_name,
                mother_maiden_name, category, religion, nationality, residential_status,
                no_of_dependents, occupation, pan_number, aadhaar_number, voter_id,
                driving_license, passport_number, passport_valid_upto,
                present_address, permanent_same_as_present, permanent_address, office_address,
                occupation_type, employer_name, designation, department, employee_no,
                employment_status, organization_type, total_experience, years_present_job,
                business_name, business_type, monthly_income
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING id
            """,
            (
                application_id, party.get("role"),
                personal.get("full_name"), personal.get("gender"), personal.get("date_of_birth"),
                personal.get("marital_status"), personal.get("spouse_name"), personal.get("father_name"),
                personal.get("mother_maiden_name"), personal.get("category"), personal.get("religion"),
                personal.get("nationality"), personal.get("residential_status"),
                personal.get("no_of_dependents"), personal.get("occupation"), personal.get("pan_number"),
                personal.get("aadhaar_number"), personal.get("voter_id"), personal.get("driving_license"),
                personal.get("passport_number"), personal.get("passport_valid_upto"),
                Jsonb(address.get("present") or {}), bool(address.get("permanent_same_as_present", True)),
                Jsonb(address["permanent"]) if address.get("permanent") else None,
                Jsonb(address["office"]) if address.get("office") else None,
                employment.get("occupation_type"), employment.get("employer_name"),
                employment.get("designation"), employment.get("department"), employment.get("employee_no"),
                employment.get("employment_status"), employment.get("organization_type"),
                employment.get("total_experience"), employment.get("years_present_job"),
                employment.get("business_name"), employment.get("business_type"),
                _to_decimal(employment.get("monthly_income")),
            ),
        ).fetchone()
        party_id = party_row["id"]

        for row in party.get("income_sources") or []:
            connection.execute(
                """INSERT INTO loan_application_party_income
                   (party_id, income_head, gross_income, net_income, frequency)
                   VALUES (%s, %s, %s, %s, %s)""",
                (party_id, row.get("income_head"), _to_decimal(row.get("gross_income")),
                 _to_decimal(row.get("net_income")), row.get("frequency")),
            )
        for row in party.get("existing_loans") or []:
            connection.execute(
                """INSERT INTO loan_application_party_existing_loans
                   (party_id, loan_bank, loan_type, loan_emi, loan_tenure, loan_outstanding)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (party_id, row.get("loan_bank"), row.get("loan_type"), _to_decimal(row.get("loan_emi")),
                 row.get("loan_tenure"), _to_decimal(row.get("loan_outstanding"))),
            )
        for row in party.get("bank_accounts") or []:
            connection.execute(
                """INSERT INTO loan_application_party_bank_accounts
                   (party_id, bank_name, bank_branch, account_type, account_number)
                   VALUES (%s, %s, %s, %s, %s)""",
                (party_id, row.get("bank_name"), row.get("bank_branch"), row.get("account_type"),
                 row.get("account_number")),
            )
        for row in party.get("assets") or []:
            connection.execute(
                """INSERT INTO loan_application_party_assets
                   (party_id, asset_type, asset_description, asset_value)
                   VALUES (%s, %s, %s, %s)""",
                (party_id, row.get("asset_type"), row.get("asset_description"),
                 _to_decimal(row.get("asset_value"))),
            )
        for row in party.get("references") or []:
            connection.execute(
                """INSERT INTO loan_application_party_references
                   (party_id, reference_name, reference_address, reference_phone)
                   VALUES (%s, %s, %s, %s)""",
                (party_id, row.get("reference_name"), row.get("reference_address"),
                 row.get("reference_phone")),
            )


async def _create_order(
    *,
    service_name: str,
    customer_name: str,
    # Optional — SignDesk's eKYC APIs (General Document Verification,
    # DigiLocker, PAN) never take or need a customer email anywhere in their
    # request payloads (confirmed directly against signdesk_ekyc.py/
    # signdesk_digilocker.py/signdesk_pan.py — none of them have an email
    # field at all), so eKYC orders don't require one either. eSign used to
    # require one too (SignDesk's Sign Request API only knew how to deliver
    # the invitation via email), but signer email is now optional there as
    # well — a signer with no email gets the invitation via SMS instead (see
    # signdesk_esign.py, esign_service.SignerIn). Every other service still
    # requires it — enforced just below, not by the type itself, since only
    # eKYC/eSign get the exception.
    customer_email: EmailStr | None,
    customer_mobile: str,
    action: str,
    document: UploadFile,
    organization_id: UUID,
    organization_user_id: UUID | None,
    enforce_user_assignment: bool,
    quantity: int = 1,
    document_type: str | None = None,
    # Set only when this order is "Initiate eKYC" from a Bulk eKYC CSV row
    # (see partner_user.py's ekyc-bulk endpoints) — every other caller omits
    # it and this function behaves exactly as before. Links that CSV row to
    # the real order atomically, in the same transaction as the order
    # insert below, so the link can never be partial.
    bulk_ekyc_record_id: UUID | None = None,
    # Set only by the Loan Document flow (partner_user.py's /orders, called
    # with the JSON-encoded structured fields the customer entered — see
    # LoanDocumentFlow.jsx) — every other caller omits it.
    loan_details: dict[str, Any] | None = None,
    document_config_id: UUID | None = None,
) -> dict[str, Any]:
    if service_name not in get_active_service_names():
        raise HTTPException(status_code=400, detail=f"Unknown service '{service_name}'")
    if customer_email is None and service_name not in ("eKYC", "eSign"):
        raise HTTPException(status_code=400, detail="Customer email is required")
    try:
        validate_mobile(customer_mobile)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if action not in ("draft", "submit"):
        raise HTTPException(status_code=400, detail="action must be 'draft' or 'submit'")
    if quantity < 1:
        raise HTTPException(status_code=400, detail="Number of copies must be at least 1")

    with get_connection() as connection:
        pricing = connection.execute(
            """
            SELECT is_active, price
            FROM organization_service_pricing
            WHERE organization_id = %s AND service_name = %s
            """,
            (organization_id, service_name),
        ).fetchone()
        if not pricing or not pricing["is_active"]:
            raise HTTPException(
                status_code=400,
                detail=f"'{service_name}' is not enabled for your account. Contact Super Admin.",
            )

        base_amount = float(pricing["price"] or 0)
        doc_esign_price = None
        if service_name == "Document Service" and document_config_id is not None:
            doc_config = connection.execute(
                """
                SELECT base_price, esign_price, status 
                FROM organization_document_config 
                WHERE id = %s AND organization_id = %s
                """,
                (document_config_id, organization_id)
            ).fetchone()
            if not doc_config or not doc_config["status"]:
                raise HTTPException(status_code=400, detail="Selected document is not enabled or not found.")
            base_amount = float(doc_config["base_price"] or 0)
            doc_esign_price = float(doc_config["esign_price"] or 0)

        organization = connection.execute(
            "SELECT payment_mode FROM organizations WHERE id = %s",
            (organization_id,),
        ).fetchone()

        # Optional "created for" user (org member). When set, the order can
        # only use a service that partner has actually assigned to THAT
        # user — enforced server-side, not just filtered in the UI. Skipped
        # for Retailer-type orgs, whose single member login IS the
        # organization (there's no upstream Partner to assign anything to
        # them — see partner_user.create_my_order).
        if organization_user_id is not None:
            membership = connection.execute(
                "SELECT id FROM organization_users WHERE id = %s AND organization_id = %s",
                (organization_user_id, organization_id),
            ).fetchone()
            if not membership:
                raise HTTPException(status_code=404, detail="User not found")

            if enforce_user_assignment:
                if service_name == "Document Service":
                    assigned = connection.execute(
                        """
                        SELECT 1 FROM partner_user_services
                        WHERE organization_user_id = %s AND document_config_id IS NOT NULL
                        LIMIT 1
                        """,
                        (organization_user_id,),
                    ).fetchone()
                else:
                    assigned = connection.execute(
                        """
                        SELECT 1 FROM partner_user_services pus
                        JOIN organization_service_pricing sp ON sp.id = pus.service_pricing_id
                        WHERE pus.organization_user_id = %s AND sp.organization_id = %s AND sp.service_name = %s
                        LIMIT 1
                        """,
                        (organization_user_id, organization_id, service_name),
                    ).fetchone()
                if not assigned:
                    raise HTTPException(
                        status_code=403,
                        detail=f"'{service_name}' is not assigned to the selected user",
                    )

    # eKYC's admin-configured additional charges (Delivery Charge, Service
    # Charge, ...) — organization_service_charge_pricing, same table/shape
    # eStamp Bulk and Manual eStamp already read (see create_bulk_estamp_order/
    # create_manual_estamp_order), just scoped here to eKYC only so the rest
    # of this shared generic path (Document Service, eNotary, eSBTR, eSign)
    # is completely unaffected. Treated as flat `price` values, same
    # simplification Manual eStamp's own non-stamp charges already use —
    # calculation_type/percentage only have a natural meaning where a face
    # value exists to apply a percentage against (eStamp Bulk's own pricing
    # engine), which eKYC has no equivalent of.
    active_charges: list[dict[str, Any]] = []
    if service_name == "eKYC":
        with get_connection() as connection:
            charge_rows = connection.execute(
                """
                SELECT charge_name, price FROM organization_service_charge_pricing
                WHERE organization_id = %s AND service_name = %s AND is_active = true
                """,
                (organization_id, service_name),
            ).fetchall()
        active_charges = [{"charge_name": row["charge_name"], "price": float(row["price"] or 0)} for row in charge_rows]
    charges_total = sum(c["price"] for c in active_charges)

    amount = base_amount * quantity + charges_total
    status = "Draft" if action == "draft" else "Submitted"
    is_esign = service_name == "eSign"

    # The wallet is reserved for real eStamp stamp-duty face value (see
    # stamp_service.initiate_stamp / partner.create_bulk_estamp_order), funded
    # by Reimbursement invoices at recharge time — AND, independently, for
    # eSign, blocked per-signer the moment a workflow is actually dispatched
    # (see esign_service.initiate_esign, which blocks price_per_signer x
    # signer count into orders.esign_wallet_blocked_amount — a column kept
    # deliberately separate from wallet_blocked_amount above so a combo order
    # can carry both blocks at once without either clobbering the other) and
    # converted to a real debit one signer at a time as each of them signs
    # (esign_service._apply_signer_status / _convert_partial_block_to_debit).
    # Order creation itself still never touches the wallet for eSign — the
    # block only happens later, at actual send time, since that's the first
    # point the signer list is known. Every other service in this generic
    # path (Document Service, eKYC, eNotary, eSBTR) still never touches the
    # wallet at all, for any payment mode — recovered entirely through a
    # normal/service invoice instead (see invoice_service._resolve_order_invoice).

    # Validate file *content* server-side — never trust filename extension or
    # Content-Type from the client (both are trivially spoofed via request
    # interception). eSign/eStamp require a real PDF without embedded scripts;
    # eKYC allows JPEG/PNG/safe-PDF; other services reject HTML/script payloads
    # and still require a safe PDF when the bytes look like one.
    raw_bytes = await document.read()
    try:
        if service_name in PDF_REQUIRED_SERVICES:
            validate_safe_pdf_bytes(raw_bytes)
            display_filename = safe_stored_pdf_filename(document.filename)
            stored_ext = ".pdf"
        elif service_name == "eKYC":
            kind = detect_ekyc_upload_kind(raw_bytes)
            display_filename = safe_stored_filename_for_kind(document.filename, kind)
            stored_ext = {"pdf": ".pdf", "jpeg": ".jpg", "png": ".png"}[kind]
        else:
            if is_valid_pdf_bytes(raw_bytes):
                validate_safe_pdf_bytes(raw_bytes)
                display_filename = safe_stored_pdf_filename(document.filename)
                stored_ext = ".pdf"
            else:
                if document.filename and document.filename.lower().endswith(".pdf"):
                    raise ValueError(
                        "Document must be a valid PDF file (file content does not match a PDF). "
                        "Renaming another file type to .pdf is not accepted."
                    )
                if getattr(document, "content_type", "") == "application/pdf":
                    raise ValueError("Document claims to be a PDF but file content does not match a PDF.")
                    
                if pdf_contains_dangerous_content(raw_bytes):
                    raise ValueError(
                        "Document was rejected because it contains embedded scripts or other "
                        "active content that is not allowed"
                    )
                display_filename = (document.filename or "document").replace("\\", "/").split("/")[-1][:200]
                stored_ext = os.path.splitext(display_filename)[1] or ".bin"
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    upload_dir = _order_upload_dir()
    stored_name = f"{uuid4()}{stored_ext}"
    with open(upload_dir / stored_name, "wb") as f:
        f.write(raw_bytes)

    esign_price_per_signer = float(pricing["price"] or 0) if is_esign else None
    if service_name == "Document Service" and document_config_id is not None:
        esign_price_per_signer = doc_esign_price

    with get_transaction() as connection:
        seq = connection.execute("SELECT nextval('orders_order_no_seq') AS n").fetchone()
        order_no = f"ORD-{seq['n']:06d}"
        order = connection.execute(
            """
            INSERT INTO orders (
                order_no, organization_id, organization_user_id, customer_name, customer_email, customer_mobile,
                service_name, document_type, document_filename, document_path, amount, quantity, status,
                esign_price_per_signer, loan_details, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            RETURNING
                id, order_no, organization_id, organization_user_id, customer_name, customer_email, customer_mobile,
                service_name, document_type, document_filename, amount, quantity, status, loan_details, created_at, updated_at
            """,
            (
                order_no, organization_id, organization_user_id, customer_name,
                str(customer_email) if customer_email else None, customer_mobile,
                service_name, document_type, display_filename, stored_name, amount, quantity, status,
                esign_price_per_signer, Jsonb(loan_details) if loan_details is not None else None,
            ),
        ).fetchone()

        # Normalized mirror of loan_details, for Loan Application orders
        # only (no-op for every other order — see _persist_loan_application).
        if loan_details:
            _persist_loan_application(connection, order["id"], loan_details)

        # Authoritative snapshot of eKYC's full charge breakdown at
        # order-creation time — the base price too, not just the additional
        # charges, labeled distinctly ("eKYC Service Charge") so it can never
        # collide with an admin-configured charge literally named "Service
        # Charge" (active_charges can contain exactly that — see
        # accounts.py's identical "Bulk eStamp Pricing" vs "Service Charge"
        # collision note for the same reasoning). This is what lets the
        # generic Financial Summary branch (OrderDetail.jsx, which just
        # iterates order.charges for any non-bulk/non-manual order) show
        # eKYC's full breakdown instead of one lumped "Service Charge" row
        # for the whole order.amount. Same "never re-read later" snapshot
        # reasoning as create_bulk_estamp_order/create_manual_estamp_order.
        if service_name == "eKYC":
            base_price = float(pricing["price"] or 0) * quantity
            if base_price > 0:
                connection.execute(
                    "INSERT INTO order_charge (order_id, charge_name, price) VALUES (%s, %s, %s)",
                    (order["id"], "eKYC Service Charge", base_price),
                )
            for charge in active_charges:
                connection.execute(
                    "INSERT INTO order_charge (order_id, charge_name, price) VALUES (%s, %s, %s)",
                    (order["id"], charge["charge_name"], charge["price"]),
                )

        # Bulk eKYC: link this CSV row to the real order we just created, in
        # the SAME transaction — the row is either linked to a real order or
        # it isn't, never partially. FOR UPDATE guards against a
        # double-click/duplicate-tab race both trying to initiate the same
        # still-unlinked row at once; if it's already linked (or doesn't
        # belong to this org), the whole order creation rolls back rather
        # than silently creating a second duplicate order for that customer.
        if bulk_ekyc_record_id is not None:
            bulk_record = connection.execute(
                """
                SELECT id FROM b2b_ekyc_bulk_record
                WHERE id = %s AND organization_id = %s AND order_id IS NULL
                FOR UPDATE
                """,
                (bulk_ekyc_record_id, organization_id),
            ).fetchone()
            if not bulk_record:
                raise HTTPException(
                    status_code=400,
                    detail="This CSV record has already been initiated or was not found.",
                )
            connection.execute(
                "UPDATE b2b_ekyc_bulk_record SET order_id = %s, updated_at = now() WHERE id = %s",
                (order["id"], bulk_ekyc_record_id),
            )

    # "Draft" isn't a placed order yet (see the action=="draft"/"submit"
    # branch above) — only notify once it's actually been submitted, same
    # distinction the status itself already encodes.
    if order["status"] == "Submitted":
        notify_new_order(order)

    return order


@router.post("/orders", status_code=201)
async def create_partner_order(
    service_name: str = Form(...),
    customer_name: str = Form(...),
    customer_email: EmailStr | None = Form(None),
    customer_mobile: str = Form(...),
    action: str = Form("submit"),
    document: UploadFile = File(...),
    organization_user_id: UUID | None = Form(None),
    quantity: int = Form(1),
    doc_type: str | None = Form(None),
    bulk_ekyc_record_id: UUID | None = Form(None),
    document_config_id: UUID | None = Form(None),
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return await _create_order(
        service_name=service_name,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_mobile=customer_mobile,
        action=action,
        document=document,
        organization_id=current_partner["organization_id"],
        organization_user_id=organization_user_id,
        enforce_user_assignment=True,
        quantity=quantity,
        document_type=doc_type,
        bulk_ekyc_record_id=bulk_ekyc_record_id,
        document_config_id=document_config_id,
    )


# =========================================
# ESTAMP BULK
#
# A separate service from "eStamp" — no document to stamp, no SignDesk call.
# A partner requests a batch of blank physical stamp papers (one or more
# denominations x quantity) for a state, always physically delivered. Order
# creation can't reuse _create_order above (that one requires an uploaded
# document and prices purely as price x quantity) — this has its own pricing
# (face value + service fee + delivery charge) and its own satellite tables
# (b2b_estamp_bulk_order, b2b_estamp_bulk_order_item — see schema.sql).
# =========================================

BULK_ESTAMP_SERVICE_NAME = "eStamp Bulk"

# Pending -> Processed -> Completed. Each status may only advance to the very
# next one in this list — validated server-side in
# update_bulk_estamp_order_status, not just hidden/shown by the frontend.
# Pending: order placed, nothing charged yet. Processed: Super Admin has
# taken the order up for processing. Completed: the eStamp request has
# actually been submitted/completed — this is the only transition that moves
# money (see the stamp-value wallet debit in update_bulk_estamp_order_status),
# never at order placement.
BULK_ESTAMP_STATUS_FLOW = ["Pending", "Processed", "Completed"]

# charge_name for the order_charge row(s) produced by matching the org's
# tiered pricing rules (organization_estamp_bulk_pricing_rule) — distinct
# from the generic charge-master-driven "Service Charge"/"Delivery Charge"
# etc. handled above, per product decision: this is an ADDITIONAL charge,
# not a replacement for those.
BULK_ESTAMP_PRICING_CHARGE_NAME = "Bulk eStamp Pricing"


def _match_bulk_estamp_pricing_rule(connection, *, organization_id: UUID, denomination: float, quantity: int) -> dict[str, Any] | None:
    """Looks up this org's Super Admin-configured rule (denomination range x
    quantity range -> charge_type + rate — see organizations.py's
    estamp-bulk-pricing-rules endpoints) matching one denomination row of a
    Bulk eStamp order. Returns None if no active rule covers this
    combination — an org with no rules configured, or a denomination/
    quantity outside every configured range, simply isn't charged for this,
    exactly like an unassigned additional charge. quantity_to IS NULL means
    "no upper bound", same as always. A 'customize' rule only matches within
    its explicit [denomination_from, denomination_to] range. An 'any' rule
    is open-ended but NOT unconditional — it only matches denominations at
    or above its own admin-entered denomination_from (denomination_to is
    always NULL/Infinity for 'any', enforced by
    organizations.BulkEstampPricingRuleIn): [denomination_from, Infinity),
    never [0, Infinity). Precedence: a matching 'customize' rule always wins
    over a matching 'any' rule (ORDER BY puts customize first) — 'any' is
    only used as the fallback when no more-specific rule covers this
    denomination. organizations.py's overlap validation prevents two
    same-type rules from both matching the same denomination x quantity
    combination."""
    return connection.execute(
        """
        SELECT id, charge_type, charge, denomination_type FROM organization_estamp_bulk_pricing_rule
        WHERE organization_id = %s AND is_active = true
          AND quantity_from <= %s AND (quantity_to IS NULL OR quantity_to >= %s)
          AND (
                (denomination_type = 'customize' AND denomination_from <= %s AND denomination_to >= %s)
             OR (denomination_type = 'any' AND denomination_from <= %s)
              )
        ORDER BY (denomination_type = 'customize') DESC, quantity_from DESC
        LIMIT 1
        """,
        (organization_id, quantity, quantity, denomination, denomination, denomination),
    ).fetchone()


# The ONLY place the Bulk eStamp Pricing formula lives — deliberately
# isolated (per product requirement) so changing how a matched rule turns
# into one line's service charge is a change in exactly this one function,
# never scattered across callers. 'fixed_amount': rate x quantity (a flat ₹
# rate per stamp). 'percentage': THIS LINE's own denomination x rate% x
# quantity — never the order's total face value or another line's
# denomination, since every denomination line is priced independently (a
# multi-line order must never let one line's rate bleed into another's).
# Decimal throughout, rounded to the nearest paisa with standard
# round-half-up — money is never computed in float here, even though the
# rest of this module still totals in float at the point these figures are
# merged into the wider (pre-existing, float-based) order calculation.
def calculate_bulk_estamp_line_charge(rule: dict[str, Any], denomination: Decimal, quantity: int) -> Decimal:
    rate = Decimal(str(rule["charge"]))
    qty = Decimal(quantity)
    if rule["charge_type"] == "percentage":
        line_charge = denomination * (rate / Decimal("100")) * qty
    else:
        line_charge = rate * qty
    return line_charge.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _compute_bulk_estamp_charges(
    connection, *, organization_id: UUID, resolved_items: list[dict[str, Any]], total_face_value: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (priced_items, additional_charges).

    priced_items is resolved_items with each entry enriched with
    pricing_rule_id/charge_type/rate/service_charge (None/0 when no rule
    matched that line) — meant to be snapshotted onto each
    b2b_estamp_bulk_order_item row so a later rule change never retroactively
    alters what an existing order shows or was charged.

    additional_charges is the existing aggregate order_charge shape: this
    org's assigned Service Charge/Delivery Charge/etc.
    (organization_service_charge_pricing) plus one summed "Bulk eStamp
    Pricing" line (the sum of every line's own service_charge above) — each
    denomination line is calculated independently via
    calculate_bulk_estamp_line_charge and only summed together at the very
    end, never priced off the order's combined total.

    Shared by create_bulk_estamp_order (Traditional Stamp Paper, computed at
    creation) and add_bulk_estamp_denomination (eStamp, computed once Admin
    supplies the denomination KASCoSA determined) so both flows are priced
    by the exact same authoritative logic — never trusted from the client
    either way. Returns ([], []) for an empty resolved_items list, e.g. a
    freshly-created eStamp order that has no denomination yet.

    Raises HTTPException(400) if this org has at least one active Bulk
    eStamp Pricing rule configured but one or more lines fall outside every
    configured denomination/quantity range (a gap between rules, or a value
    past every rule's bound) — an org that's never configured this feature
    at all is left exactly as before (₹0 charge, same as an unassigned
    additional charge), but an org that HAS opted into tiered pricing must
    never have a line silently go uncharged because it fell through a gap.
    """
    if not resolved_items:
        return [], []

    assigned_charges = connection.execute(
        """
        SELECT charge_name, price, calculation_type, percentage, minimum_amount
        FROM organization_service_charge_pricing
        WHERE organization_id = %s AND service_name = %s AND is_active = true
        """,
        (organization_id, BULK_ESTAMP_SERVICE_NAME),
    ).fetchall()

    additional_charges: list[dict[str, Any]] = []
    for row in assigned_charges:
        if row["charge_name"] == "Service Charge" and row["calculation_type"] == "percentage":
            percentage_charge = total_face_value * float(row["percentage"] or 0) / 100
            amount = max(percentage_charge, float(row["minimum_amount"] or 0))
        else:
            amount = float(row["price"] or 0)
        additional_charges.append({"charge_name": row["charge_name"], "price": amount})

    org_has_pricing_rules = connection.execute(
        "SELECT 1 FROM organization_estamp_bulk_pricing_rule WHERE organization_id = %s AND is_active = true LIMIT 1",
        (organization_id,),
    ).fetchone() is not None

    priced_items: list[dict[str, Any]] = []
    unmatched_lines: list[str] = []
    bulk_pricing_charge_total = Decimal("0")
    for item in resolved_items:
        rule = _match_bulk_estamp_pricing_rule(
            connection, organization_id=organization_id,
            denomination=item["denomination"], quantity=item["quantity"],
        )
        if rule:
            line_charge = calculate_bulk_estamp_line_charge(rule, Decimal(str(item["denomination"])), item["quantity"])
            priced_items.append({
                **item, "pricing_rule_id": rule["id"], "charge_type": rule["charge_type"],
                "rate": float(rule["charge"]), "service_charge": float(line_charge),
            })
            bulk_pricing_charge_total += line_charge
        else:
            priced_items.append({**item, "pricing_rule_id": None, "charge_type": None, "rate": None, "service_charge": 0.0})
            unmatched_lines.append(f"₹{item['denomination']:,.2f} × {item['quantity']}")

    if org_has_pricing_rules and unmatched_lines:
        # Exact required wording — no "contact administrator"/extra detail
        # appended, per product requirement.
        raise HTTPException(status_code=400, detail="No pricing rule configured for this denomination.")

    if bulk_pricing_charge_total > 0:
        additional_charges.append({"charge_name": BULK_ESTAMP_PRICING_CHARGE_NAME, "price": float(bulk_pricing_charge_total)})

    return priced_items, additional_charges


def get_bulk_estamp_order_detail(order_id: UUID, *, connection=None) -> dict[str, Any] | None:
    """The bulk-specific data for an order (state, totals, delivery address,
    denomination line items) — None if this order has no bulk satellite row
    (i.e. it isn't an eStamp Bulk order). Attached onto the flat `orders` row
    by both get_partner_order_with_esign (member/partner detail) and
    get_bulk_estamp_order_admin (Super Admin detail) so there's one source of
    truth for the shape of this sub-object."""

    def _fetch(conn) -> dict[str, Any] | None:
        satellite = conn.execute(
            """
            SELECT b.stamp_state_id, s.state_name AS stamp_state_label, b.total_quantity, b.total_face_value,
                   b.service_fee, b.delivery_charge, b.delivery_full_name, b.delivery_mobile,
                   b.delivery_address_line1, b.delivery_address_line2, b.delivery_city, b.delivery_state,
                   b.delivery_pincode, b.delivered_at,
                   b.first_party_name, b.first_party_address, b.second_party_name, b.second_party_address,
                   b.paying_party,
                   b.stamp_paper_type, b.consideration_amount, b.article_code_id, b.stamp_number,
                   ac.article_code, ac.description AS article_code_description
            FROM b2b_estamp_bulk_order b
            JOIN state s ON s.id = b.stamp_state_id
            LEFT JOIN b2b_article_code ac ON ac.id = b.article_code_id
            WHERE b.order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not satellite:
            return None
        items = conn.execute(
            """
            SELECT id, stamp_denomination_id, denomination, quantity, face_value,
                   pricing_rule_id, charge_type, rate, service_charge
            FROM b2b_estamp_bulk_order_item
            WHERE order_id = %s
            ORDER BY denomination ASC
            """,
            (order_id,),
        ).fetchall()
        # The authoritative, generic charge breakdown snapshotted at order
        # creation (see create_bulk_estamp_order) — empty for orders placed
        # before this mechanism existed, which only have the legacy
        # `delivery_charge` column above populated.
        charges = conn.execute(
            "SELECT charge_name, price FROM order_charge WHERE order_id = %s ORDER BY charge_name ASC",
            (order_id,),
        ).fetchall()
        # Plain existence check, never creates one — lets the Order Detail
        # page show "Download Invoice" only once a real invoice row exists
        # (see update_bulk_estamp_order_status, which generates it
        # automatically the moment the order reaches Completed), instead of
        # inferring availability from order.status alone. An order can have
        # two invoices now (Reimbursement + Invoice — see
        # invoice_service._resolve_order_invoice), so this is ordered rather
        # than a plain fetchone() to keep the single invoice_number field
        # below deterministic instead of picking whichever row Postgres
        # happens to return first.
        invoices = conn.execute(
            "SELECT invoice_number FROM b2b_invoices WHERE order_id = %s ORDER BY (invoice_type = 'Invoice') DESC",
            (order_id,),
        ).fetchall()
        # Wallet credits raised specifically to cover a short balance on THIS
        # order (wallet_transactions.order_id / organization_user_wallet_
        # transactions.order_id — see schema.sql and organizations.
        # create_wallet_transaction). A component of the order, not a
        # separate order of its own — see reports.list_wallet_reimbursement_
        # reports, which excludes these from its own standalone listing for
        # exactly this reason. Status is intentionally NOT read from here:
        # the caller renders it from the parent order's own status instead,
        # per the "parent order status controls every component" rule.
        wallet_reimbursements = conn.execute(
            """
            SELECT t.id, t.amount, t.description, t.created_at,
                   (SELECT bi.invoice_number FROM b2b_invoices bi WHERE bi.wallet_transaction_id = t.id) AS invoice_number
            FROM wallet_transactions t
            WHERE t.order_id = %s AND t.type = 'credit'

            UNION ALL

            SELECT t.id, t.amount, t.description, t.created_at,
                   (SELECT bi.invoice_number FROM b2b_invoices bi WHERE bi.organization_user_wallet_transaction_id = t.id) AS invoice_number
            FROM organization_user_wallet_transactions t
            WHERE t.order_id = %s AND t.type = 'credit'

            ORDER BY created_at ASC
            """,
            (order_id, order_id),
        ).fetchall()
        # GST breakdown for display in the order summary/detail Pricing card
        # — mirrors invoice_service._resolve_order_invoice's own math exactly
        # (18% CGST+SGST for a Karnataka-billed org, IGST otherwise, applied
        # only to the service/charges portion — stamp face value stays a 0%
        # pass-through, same as the Reimbursement invoice) so this display
        # can never drift from what the actual downloadable invoice shows.
        # This does NOT change what gets wallet-debited (see
        # create_bulk_estamp_order/add_bulk_estamp_denomination's final_total)
        # — it's informational, same GST the tax invoice adds on top.
        org_state = conn.execute(
            """
            SELECT s.state_name FROM orders o
            JOIN organizations org ON org.id = o.organization_id
            LEFT JOIN state s ON s.id = org.state_id
            WHERE o.id = %s
            """,
            (order_id,),
        ).fetchone()
        karnataka = ((org_state["state_name"] if org_state else None) or "").strip().lower() == "karnataka"

        service_fee = Decimal(str(satellite["service_fee"] or 0))
        if charges:
            charges_subtotal = service_fee + sum((Decimal(str(c["price"] or 0)) for c in charges), Decimal("0"))
        else:
            # Same fallback as invoice_service._resolve_order_invoice: orders
            # placed before the generic order_charge mechanism existed only
            # have the legacy delivery_charge column.
            charges_subtotal = service_fee + Decimal(str(satellite["delivery_charge"] or 0))

        if karnataka:
            cgst_amount = sgst_amount = (charges_subtotal * Decimal("9") / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            igst_amount = Decimal("0.00")
        else:
            cgst_amount = sgst_amount = Decimal("0.00")
            igst_amount = (charges_subtotal * Decimal("18") / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        gst_amount = cgst_amount + sgst_amount + igst_amount
        total_face_value = Decimal(str(satellite["total_face_value"] or 0))
        total_payable = total_face_value + charges_subtotal + gst_amount

        return {
            **satellite, "items": items, "charges": charges,
            "invoice_number": invoices[0]["invoice_number"] if invoices else None,
            "invoice_numbers": [row["invoice_number"] for row in invoices],
            "wallet_reimbursements": wallet_reimbursements,
            "karnataka": karnataka,
            "gst_percentage": 18,
            "cgst_amount": float(cgst_amount),
            "sgst_amount": float(sgst_amount),
            "igst_amount": float(igst_amount),
            "gst_amount": float(gst_amount),
            "total_payable": float(total_payable),
        }

    if connection is not None:
        return _fetch(connection)
    with get_connection() as connection:
        return _fetch(connection)


def create_bulk_estamp_order(
    *,
    organization_id: UUID,
    # Optional — required for the User Portal's own creation (always the
    # calling member's own id), but a Partner can also place this order
    # org-wide with no specific "Created For" user, same as _create_order
    # and create_manual_estamp_order already allow.
    organization_user_id: UUID | None,
    customer_name: str | None,
    customer_email: str | None,
    customer_mobile: str | None,
    stamp_state_id: UUID,
    items: list[dict[str, Any]],
    delivery_address: dict[str, Any],
    party_details: dict[str, Any],
    consideration_amount: float | None = None,
    article_code_id: UUID | None = None,
) -> dict[str, Any]:
    if BULK_ESTAMP_SERVICE_NAME not in get_active_service_names():
        raise HTTPException(status_code=400, detail=f"Unknown service '{BULK_ESTAMP_SERVICE_NAME}'")
    try:
        # Customer details are optional for eStamp Bulk — only format-check
        # the mobile number when one was actually given.
        if customer_mobile:
            validate_mobile(customer_mobile)
        validate_mobile(delivery_address["mobile"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    with get_connection() as connection:
        pricing = connection.execute(
            "SELECT is_active, price FROM organization_service_pricing WHERE organization_id = %s AND service_name = %s",
            (organization_id, BULK_ESTAMP_SERVICE_NAME),
        ).fetchone()
        if not pricing or not pricing["is_active"]:
            raise HTTPException(
                status_code=400,
                detail=f"'{BULK_ESTAMP_SERVICE_NAME}' is not enabled for your account. Contact Super Admin.",
            )

        organization = connection.execute(
            """
            SELECT o.organization_type, o.payment_mode, o.organization_name,
                   o.address_line1, o.address_line2, o.city, o.pincode, s.state_name
            FROM organizations o
            LEFT JOIN state s ON s.id = o.state_id
            WHERE o.id = %s
            """,
            (organization_id,),
        ).fetchone()

        # Stamp party details — one of First/Second Party is always this
        # ordering Partner; its name/address come from the organization row
        # just fetched, never from the client, so the Partner's own identity
        # on the stamp can never be spoofed or hand-edited (see
        # BulkEstampPartyDetailsIn in partner_user.py, which only ever
        # accepts the OTHER party's details plus which position the Partner
        # is in). Requires the org's own registered address to be complete —
        # can't put the Partner on a stamp with a blank/partial address.
        partner_address = ", ".join(
            part for part in (
                organization["address_line1"], organization["address_line2"],
                organization["city"], organization["state_name"], organization["pincode"],
            ) if part
        )
        if not organization["address_line1"] or not organization["city"] or not organization["state_name"] or not organization["pincode"]:
            raise HTTPException(
                status_code=400,
                detail="Your organization's registered address is incomplete. Contact Super Admin to complete your profile before placing an eStamp Bulk order.",
            )
        other_party_name = party_details["other_party_name"]
        other_party_address = party_details["other_party_address"]
        if party_details["partner_party"] == "first":
            first_party_name, first_party_address = organization["organization_name"], partner_address
            second_party_name, second_party_address = other_party_name, other_party_address
        else:
            first_party_name, first_party_address = other_party_name, other_party_address
            second_party_name, second_party_address = organization["organization_name"], partner_address
        paying_party = party_details["paying_party"]

        # Same rule _create_order enforces for every other service: assignment
        # is only checked when a specific "Created For" user was actually
        # given; a Partner placing this org-wide (no user picked) skips it
        # entirely. Dealer orgs that DO name a user still require an explicit
        # per-member assignment; a Retailer's single member login IS the
        # organization (see list_my_services), so it never needs one either way.
        if organization_user_id is not None and organization["organization_type"] != "Retailer":
            assigned = connection.execute(
                """
                SELECT 1 FROM partner_user_services pus
                JOIN organization_service_pricing sp ON sp.id = pus.service_pricing_id
                WHERE pus.organization_user_id = %s AND sp.organization_id = %s AND sp.service_name = %s
                LIMIT 1
                """,
                (organization_user_id, organization_id, BULK_ESTAMP_SERVICE_NAME),
            ).fetchone()
            if not assigned:
                raise HTTPException(
                    status_code=403,
                    detail=f"'{BULK_ESTAMP_SERVICE_NAME}' is not assigned to your account",
                )

        # stamp_paper_type is ALWAYS resolved from the state's own Super
        # Admin configuration here — never accepted from the client (see
        # catalog.list_states / b2b_state_stamp_config; a state with no
        # explicit config defaults to Traditional Stamp Paper, same
        # default catalog.list_states uses, so behavior for every
        # already-existing state is unaffected by this feature).
        state = connection.execute(
            f"""
            SELECT s.id, COALESCE(c.stamp_paper_type, '{STAMP_PAPER_TYPE_TRADITIONAL}') AS stamp_paper_type
            FROM state s
            LEFT JOIN b2b_state_stamp_config c ON c.state_id = s.id
            WHERE s.id = %s
            """,
            (stamp_state_id,),
        ).fetchone()
        if not state:
            raise HTTPException(status_code=400, detail="Invalid stamp state")
        stamp_paper_type = state["stamp_paper_type"]
        # A state can be configured with an admin-added custom type name
        # (see catalog.py's stamp-paper-types endpoints) that has no real
        # order-creation flow behind it — block here rather than silently
        # falling through to the Traditional branch below, which would
        # otherwise happen since is_estamp_state would just be False for
        # any non-eStamp value, custom or not.
        if stamp_paper_type not in (STAMP_PAPER_TYPE_TRADITIONAL, STAMP_PAPER_TYPE_ESTAMP):
            raise HTTPException(
                status_code=400,
                detail=f"'{stamp_paper_type}' stamp paper type isn't supported for order creation yet — coming soon.",
            )
        is_estamp_state = stamp_paper_type == STAMP_PAPER_TYPE_ESTAMP

        seen_denominations: set[UUID] = set()
        resolved_items: list[dict[str, Any]] = []
        total_quantity = 0
        total_face_value = 0.0

        if is_estamp_state:
            # eStamp states: the Partner picks no denomination at all — Super
            # Admin/LegalDesk determines it later by manually checking
            # KASCoSA against the Consideration Amount + Article Code (see
            # add_bulk_estamp_denomination below). Nothing here is
            # chargeable yet, so resolved_items stays empty and
            # total_quantity/total_face_value stay 0 — the order still gets
            # created (Pending), just with its financials filled in later,
            # against this SAME order/order_id, never a new one.
            if items:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{stamp_paper_type}' states don't use denomination selection — Admin adds the denomination after determining it via KASCoSA.",
                )
            if consideration_amount is None or consideration_amount <= 0:
                raise HTTPException(status_code=400, detail="Consideration Amount is required and must be greater than 0")
            if article_code_id is None:
                raise HTTPException(status_code=400, detail="Article Code is required")
            # Must belong to the SAME state as stamp_state_id — never trusted
            # from the client (see ArticleCodeSearchSelect on the create-order
            # form, which only ever lists the selected state's own codes, but
            # a hand-edited request must be rejected exactly the same way).
            article_code_row = connection.execute(
                "SELECT id FROM b2b_article_code WHERE id = %s AND is_active = true AND state_id = %s",
                (article_code_id, stamp_state_id),
            ).fetchone()
            if not article_code_row:
                raise HTTPException(status_code=400, detail="Selected Article Code is not available for this state")
        else:
            if consideration_amount is not None or article_code_id is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Consideration Amount and Article Code only apply to eStamp states.",
                )
            if not items:
                raise HTTPException(status_code=400, detail="At least one stamp denomination row is required")

            # Denominations/face values are always recomputed from the real
            # master here, never trusted from the client — a row must be
            # active and actually belong to the selected state. A
            # client-typed custom amount (no stamp_denomination_id — see
            # BulkEstampItemIn) never needs Super Admin to have
            # pre-configured it: find-or-create the master row for (state,
            # value) instead of rejecting it, same "no need to configure
            # ahead of time" rule already applied to state selection.
            # ON CONFLICT reuses/reactivates an existing row rather than
            # ever creating a duplicate for the same (state, value) pair —
            # see the unique constraint on b2b_stamp_denomination in
            # schema.sql.
            for item in items:
                quantity = int(item["quantity"])
                if quantity < 1:
                    raise HTTPException(status_code=400, detail="Quantity must be at least 1 for every denomination row")

                denomination_id = item.get("stamp_denomination_id")
                if denomination_id:
                    denomination = connection.execute(
                        "SELECT id, stamp_value FROM b2b_stamp_denomination WHERE id = %s AND state_id = %s AND is_active = true",
                        (denomination_id, stamp_state_id),
                    ).fetchone()
                    if not denomination:
                        raise HTTPException(
                            status_code=400,
                            detail="One of the selected stamp denominations is not available for this state",
                        )
                else:
                    stamp_value = item.get("stamp_value")
                    if not stamp_value or stamp_value <= 0:
                        raise HTTPException(status_code=400, detail="Stamp denomination amount must be greater than 0")
                    denomination = connection.execute(
                        """
                        INSERT INTO b2b_stamp_denomination (state_id, stamp_value, is_active)
                        VALUES (%s, %s, true)
                        ON CONFLICT (state_id, stamp_value) DO UPDATE SET is_active = true, updated_at = now()
                        RETURNING id, stamp_value
                        """,
                        (stamp_state_id, stamp_value),
                    ).fetchone()

                if denomination["id"] in seen_denominations:
                    raise HTTPException(status_code=400, detail="Duplicate stamp denomination in request")
                seen_denominations.add(denomination["id"])

                face_value = float(denomination["stamp_value"]) * quantity
                total_quantity += quantity
                total_face_value += face_value
                resolved_items.append(
                    {
                        "stamp_denomination_id": denomination["id"],
                        "denomination": float(denomination["stamp_value"]),
                        "quantity": quantity,
                        "face_value": face_value,
                    }
                )

        # This org's assigned additional charges (Service Charge, Delivery
        # Charge, ...) plus any matching Bulk eStamp Pricing rules — see
        # _compute_bulk_estamp_charges. Naturally empty for an eStamp order
        # at creation time (resolved_items is []); computed for real once
        # Admin adds the denomination (see add_bulk_estamp_denomination).
        priced_items, additional_charges = _compute_bulk_estamp_charges(
            connection, organization_id=organization_id, resolved_items=resolved_items, total_face_value=total_face_value,
        )
        additional_charges_total = sum(c["price"] for c in additional_charges)

        # Availability is actually reserved (not just checked) once the order
        # row exists below — see _block_wallet_amount call after the INSERT.
        # Only the stamp face value is blocked here, never
        # additional_charges_total — additional charges are the "service
        # charge" (Service Charge/Delivery Charge/Bulk eStamp Pricing/etc.),
        # never blocked at placement and only ever wallet-debited later, at
        # Generate Invoice time (see invoice_service.get_or_create_invoice_
        # for_order's charge_wallet param). PPS orgs never touch the wallet
        # at all, same as everywhere else.
        payment_mode = organization["payment_mode"] or "Wallet"
    # Backward-compat snapshot for existing screens/invoicing that still read
    # b2b_estamp_bulk_order.delivery_charge directly — specifically the
    # "Delivery Charge"-named entry, if one is assigned. The full breakdown
    # (every assigned charge, whatever it's called) is snapshotted into
    # order_charge below, which is the authoritative source going forward.
    delivery_charge_compat = sum(c["price"] for c in additional_charges if c["charge_name"] == "Delivery Charge")

    # eStamp Bulk has no Base Price of its own (organization_service_pricing
    # for this service is force-nulled/reported as 0 — see
    # organizations.get_organization_pricing/update_organization_pricing):
    # the stamp value already comes dynamically from denomination x quantity
    # above, and the service's own fee is charged entirely through the
    # "Service Charge" additional charge computed above. Multiplying Base
    # Price into a second service fee here would double-charge on top of
    # that — service_fee is kept (always 0) only because
    # b2b_estamp_bulk_order.service_fee is NOT NULL, for old orders created
    # before this change to keep displaying their real historical fee.
    service_fee = 0.0
    final_total = total_face_value + service_fee + additional_charges_total

    with get_transaction() as connection:
        seq = connection.execute("SELECT nextval('orders_order_no_seq') AS n").fetchone()
        order_no = f"ORD-{seq['n']:06d}"
        order = connection.execute(
            """
            INSERT INTO orders (
                order_no, organization_id, organization_user_id, customer_name, customer_email, customer_mobile,
                service_name, amount, quantity, status, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            RETURNING id, order_no, organization_id, organization_user_id, customer_name, customer_email,
                      customer_mobile, service_name, amount, quantity, status, created_at, updated_at
            """,
            (
                order_no, organization_id, organization_user_id, customer_name,
                str(customer_email) if customer_email else None, customer_mobile,
                BULK_ESTAMP_SERVICE_NAME, final_total, total_quantity, BULK_ESTAMP_STATUS_FLOW[0],
            ),
        ).fetchone()

        connection.execute(
            """
            INSERT INTO b2b_estamp_bulk_order (
                order_id, stamp_state_id, total_quantity, total_face_value, service_fee, delivery_charge,
                delivery_full_name, delivery_mobile, delivery_address_line1, delivery_address_line2,
                delivery_city, delivery_state, delivery_pincode,
                first_party_name, first_party_address, second_party_name, second_party_address, paying_party,
                stamp_paper_type, consideration_amount, article_code_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                order["id"], stamp_state_id, total_quantity, total_face_value, service_fee, delivery_charge_compat,
                delivery_address["full_name"], delivery_address["mobile"], delivery_address["address_line1"],
                delivery_address.get("address_line2"), delivery_address["city"], delivery_address["state"],
                delivery_address["pincode"],
                first_party_name, first_party_address, second_party_name, second_party_address, paying_party,
                stamp_paper_type, consideration_amount, article_code_id,
            ),
        )

        for item in priced_items:
            connection.execute(
                """
                INSERT INTO b2b_estamp_bulk_order_item
                    (order_id, stamp_denomination_id, denomination, quantity, face_value,
                     pricing_rule_id, charge_type, rate, service_charge)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    order["id"], item["stamp_denomination_id"], item["denomination"],
                    item["quantity"], item["face_value"],
                    item["pricing_rule_id"], item["charge_type"], item["rate"], item["service_charge"],
                ),
            )

        # Authoritative snapshot of every additional charge actually applied
        # at order-creation time — copied here rather than re-read from
        # organization_service_charge_pricing later, so a subsequent Super
        # Admin config change never retroactively alters this order's total
        # or invoice (same reasoning as the face_value/service_fee snapshots
        # above).
        for charge in additional_charges:
            connection.execute(
                "INSERT INTO order_charge (order_id, charge_name, price) VALUES (%s, %s, %s)",
                (order["id"], charge["charge_name"], charge["price"]),
            )

        # No wallet DEDUCTION at order placement — the stamp face value is
        # only ever converted from a block into a real debit once Super
        # Admin marks the order Completed (see update_bulk_estamp_order_status).
        # It IS blocked/reserved here, though, so this money can't also be
        # committed to another pending order in the meantime. eStamp
        # (KASCoSA) states start with total_face_value 0 — nothing to block
        # yet; add_bulk_estamp_denomination blocks it once Admin determines
        # the real value.
        if payment_mode != "PPS" and total_face_value > 0:
            _block_wallet_amount(
                connection,
                organization_id=organization_id, organization_user_id=organization_user_id,
                amount=total_face_value, order_id=order["id"],
                description=f"Order {order_no} · {BULK_ESTAMP_SERVICE_NAME} · Stamp Value (blocked)",
            )

    notify_new_order(order)

    order["bulk_estamp"] = get_bulk_estamp_order_detail(order["id"])
    return order


def get_bulk_estamp_order_admin(order_id: UUID) -> dict[str, Any]:
    """Super Admin's order detail — unlike get_partner_order_with_esign, not
    scoped to a specific organization (admin can view any partner's order)."""
    with get_connection() as connection:
        order = connection.execute(
            """
            SELECT o.id, o.order_no, o.organization_id, org.organization_name AS partner_name,
                   o.organization_user_id, COALESCE(u.full_name, org.organization_name) AS created_by,
                   o.customer_name, o.customer_email, o.customer_mobile,
                   o.service_name, o.amount, o.quantity, o.status, o.created_at, o.updated_at
            FROM orders o
            JOIN organizations org ON org.id = o.organization_id
            LEFT JOIN organization_users ou ON ou.id = o.organization_user_id
            LEFT JOIN users u ON u.id = ou.user_id
            WHERE o.id = %s
            """,
            (order_id,),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["service_name"] != BULK_ESTAMP_SERVICE_NAME:
            raise HTTPException(status_code=400, detail="Not an eStamp Bulk order")
        order["bulk_estamp"] = get_bulk_estamp_order_detail(order_id, connection=connection)
    return order


def update_bulk_estamp_order_status(order_id: UUID, new_status: str, stamp_number: str | None = None) -> dict[str, Any]:
    if new_status not in BULK_ESTAMP_STATUS_FLOW:
        raise HTTPException(status_code=400, detail=f"Unknown status '{new_status}'")

    with get_transaction() as connection:
        order = connection.execute(
            """
            SELECT o.id, o.status, o.service_name, o.order_no, o.organization_id, o.organization_user_id,
                   o.stamp_value_wallet_debited, org.payment_mode
            FROM orders o
            JOIN organizations org ON org.id = o.organization_id
            WHERE o.id = %s
            """,
            (order_id,),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["service_name"] != BULK_ESTAMP_SERVICE_NAME:
            raise HTTPException(status_code=400, detail="Not an eStamp Bulk order")

        current_index = (
            BULK_ESTAMP_STATUS_FLOW.index(order["status"]) if order["status"] in BULK_ESTAMP_STATUS_FLOW else -1
        )
        next_index = current_index + 1
        if next_index >= len(BULK_ESTAMP_STATUS_FLOW) or BULK_ESTAMP_STATUS_FLOW[next_index] != new_status:
            allowed = BULK_ESTAMP_STATUS_FLOW[next_index] if 0 <= next_index < len(BULK_ESTAMP_STATUS_FLOW) else None
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot move from '{order['status']}' to '{new_status}'. "
                    + (f"Next allowed status is '{allowed}'." if allowed else "This order is already Completed.")
                ),
            )

        # An eStamp order (see b2b_estamp_bulk_order.stamp_paper_type) starts
        # with no denomination — the Partner never selects one, Admin adds it
        # later after manually checking KASCoSA (see
        # add_bulk_estamp_denomination). Nothing is chargeable/invoiceable
        # without it, so Completed is blocked until at least one item row
        # exists; Pending -> Processed still works fine either way (Admin may
        # be actively checking KASCoSA while the order sits at Processed).
        if new_status == "Completed":
            item_count = connection.execute(
                "SELECT COUNT(*) AS n FROM b2b_estamp_bulk_order_item WHERE order_id = %s", (order_id,)
            ).fetchone()["n"]
            if item_count == 0:
                raise HTTPException(
                    status_code=400,
                    detail="This order has no denomination yet. Use \"Add Denomination\" first, then mark it Completed.",
                )

            # Certificate number of the physical stamp paper actually
            # procured — Super Admin enters it in a required popup right
            # before this call (see estamp_bulk.py's status endpoint /
            # EstampBulkSection.jsx), so every order is expected to reach
            # Completed with one attached.
            if not stamp_number or not stamp_number.strip():
                raise HTTPException(status_code=400, detail="Enter the stamp number before marking this order Completed.")

            connection.execute(
                "UPDATE b2b_estamp_bulk_order SET stamp_number = %s WHERE order_id = %s",
                (stamp_number.strip(), order_id),
            )

        connection.execute(
            "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
            (new_status, order_id),
        )

        # The stamp face value converts from its placement-time block (see
        # create_bulk_estamp_order/add_bulk_estamp_denomination) into a real
        # debit the moment the order actually reaches Completed — never at
        # placement, never at Processed. Guarded by stamp_value_wallet_debited
        # so a retry/duplicate call can't double-debit. Additional charges
        # (Service Charge, Delivery Charge, Documentation Charge, ...) are
        # NOT debited here at all any more — they're the "service charge",
        # deducted separately at Generate Invoice time instead (see
        # invoice_service.get_or_create_invoice_for_order's charge_wallet
        # param). PPS orgs are billed per service instead and never touch the
        # wallet at all (same rule as every other order type).
        if new_status == "Completed" and not order["stamp_value_wallet_debited"] and (order["payment_mode"] or "Wallet") != "PPS":
            bulk = connection.execute(
                "SELECT total_face_value FROM b2b_estamp_bulk_order WHERE order_id = %s", (order_id,)
            ).fetchone()
            if float(bulk["total_face_value"]) > 0:
                _convert_block_to_debit(
                    connection,
                    organization_id=order["organization_id"],
                    organization_user_id=order["organization_user_id"],
                    amount=float(bulk["total_face_value"]),
                    order_id=order_id,
                    description=f"Order {order['order_no']} · {BULK_ESTAMP_SERVICE_NAME} · Stamp Value",
                )

            connection.execute(
                "UPDATE orders SET stamp_value_wallet_debited = true WHERE id = %s",
                (order_id,),
            )

    if new_status == "Completed":
        _auto_generate_bulk_estamp_invoice_on_completion(
            order_id=order_id, organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
        )
        _auto_generate_wallet_reimbursement_invoices_on_completion(
            order_id=order_id, organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
        )
        notify_order_completed(
            organization_id=order["organization_id"], order_id=order_id,
            order_no=order["order_no"], service_name=order["service_name"],
            organization_user_id=order["organization_user_id"],
        )

    return get_bulk_estamp_order_admin(order_id)


def cancel_bulk_estamp_order(order_id: UUID, reason: str | None = None) -> dict[str, Any]:
    """Admin-only cancel for an eStamp Bulk order still at Pending/Processed
    — releases whatever stamp value is currently blocked (see
    create_bulk_estamp_order/add_bulk_estamp_denomination) back to available
    balance and marks the order Cancelled. Never allowed once Completed —
    by then the wallet's already been debited for real (stamp_value_wallet_
    debited) and the invoice already generated off it; there's no reversal
    path for that, same as every other terminal-status boundary in this
    module. `reason` is optional here since the OrderDetail.jsx inline
    Cancel button (this function's other caller) doesn't collect one — Order
    Reports' generic Cancel Order action (reports.cancel_order_report) is
    the one that requires it, enforced there before this ever runs."""
    with get_transaction() as connection:
        order = connection.execute(
            """
            SELECT id, status, service_name, order_no, organization_id, organization_user_id, wallet_blocked_amount
            FROM orders WHERE id = %s FOR UPDATE
            """,
            (order_id,),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["service_name"] != BULK_ESTAMP_SERVICE_NAME:
            raise HTTPException(status_code=400, detail="Not an eStamp Bulk order")
        if order["status"] not in ("Pending", "Processed"):
            raise HTTPException(status_code=400, detail=f"Cannot cancel an order that is already '{order['status']}'")

        if float(order["wallet_blocked_amount"]) > 0:
            _release_wallet_block(
                connection,
                organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
                amount=float(order["wallet_blocked_amount"]), order_id=order_id,
            )

        connection.execute(
            "UPDATE orders SET status = 'Cancelled', cancellation_reason = %s, updated_at = now() WHERE id = %s",
            (reason, order_id),
        )

    return get_bulk_estamp_order_admin(order_id)


# eStamp orders (see b2b_estamp_bulk_order.stamp_paper_type) have no
# denomination at creation — Super Admin/LegalDesk determines it later by
# manually checking KASCoSA against the order's Consideration Amount +
# Article Code (no automated integration exists for this yet). This writes
# that denomination into the SAME order (never a new one): one
# b2b_estamp_bulk_order_item row at quantity 1 (an eStamp order represents a
# single stamp paper — there's no multi-quantity concept for it, unlike
# Traditional Stamp Paper's denomination x quantity rows), then recomputes
# total_face_value/total_quantity/order.amount and every additional charge
# via the exact same _compute_bulk_estamp_charges Traditional orders use at
# creation — the Partner never supplies or influences this figure, and
# neither does this endpoint's caller beyond the raw denomination amount.
# Callable again to correct a mistaken entry (deletes and replaces the prior
# item/charges) as long as the order hasn't reached Completed yet — past
# that point the wallet's already been debited and the invoice already
# generated off the old numbers, so changing them further would desync both.
def add_bulk_estamp_denomination(order_id: UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
    """Admin's manual-KASCoSA-lookup result for an eStamp order — one or more
    denomination lines (an eStamp order can need more than one stamp paper
    behind a single Consideration Amount, exactly like Traditional Stamp
    Paper's multi-row order does), each priced independently through the
    same Bulk eStamp Pricing engine Traditional orders use at creation
    (_compute_bulk_estamp_charges / calculate_bulk_estamp_line_charge) —
    never a partner-suppliable amount. Writes into the SAME order (never a
    new one): replaces this order's item rows and recomputes
    total_face_value/total_quantity/order.amount and every additional
    charge. Callable again to correct a mistaken entry (deletes and replaces
    every prior line) as long as the order hasn't reached Completed yet —
    past that point the wallet's already been debited and the invoice
    already generated off the old numbers, so changing them further would
    desync both.
    """
    if not items:
        raise HTTPException(status_code=400, detail="At least one denomination line is required")
    for item in items:
        if item.get("denomination") is None or item["denomination"] <= 0:
            raise HTTPException(status_code=400, detail="Denomination must be greater than 0 for every line")
        if item.get("quantity") is None or int(item["quantity"]) < 1:
            raise HTTPException(status_code=400, detail="Quantity must be at least 1 for every line")

    with get_transaction() as connection:
        order = connection.execute(
            """
            SELECT o.id, o.status, o.organization_id, o.organization_user_id, o.order_no, o.wallet_blocked_amount,
                   org.payment_mode
            FROM orders o JOIN organizations org ON org.id = o.organization_id
            WHERE o.id = %s
            """,
            (order_id,),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        bulk = connection.execute(
            "SELECT stamp_paper_type FROM b2b_estamp_bulk_order WHERE order_id = %s", (order_id,)
        ).fetchone()
        if not bulk:
            raise HTTPException(status_code=400, detail="Not an eStamp Bulk order")
        if bulk["stamp_paper_type"] != STAMP_PAPER_TYPE_ESTAMP:
            raise HTTPException(status_code=400, detail=f"Denomination is only added this way for '{STAMP_PAPER_TYPE_ESTAMP}' orders")
        if order["status"] == "Completed":
            raise HTTPException(status_code=400, detail="This order is already Completed — its denomination can no longer be changed")

        resolved_items: list[dict[str, Any]] = []
        total_quantity = 0
        total_face_value = 0.0
        for item in items:
            quantity = int(item["quantity"])
            denomination = float(item["denomination"])
            face_value = denomination * quantity
            total_quantity += quantity
            total_face_value += face_value
            resolved_items.append({
                "stamp_denomination_id": None, "denomination": denomination,
                "quantity": quantity, "face_value": face_value,
            })

        priced_items, additional_charges = _compute_bulk_estamp_charges(
            connection, organization_id=order["organization_id"], resolved_items=resolved_items, total_face_value=total_face_value,
        )
        additional_charges_total = sum(c["price"] for c in additional_charges)
        final_total = total_face_value + additional_charges_total

        # Replace, not append — supports re-entering corrected values before
        # Completed.
        connection.execute("DELETE FROM b2b_estamp_bulk_order_item WHERE order_id = %s", (order_id,))
        connection.execute("DELETE FROM order_charge WHERE order_id = %s", (order_id,))

        for line in priced_items:
            connection.execute(
                """
                INSERT INTO b2b_estamp_bulk_order_item
                    (order_id, stamp_denomination_id, denomination, quantity, face_value,
                     pricing_rule_id, charge_type, rate, service_charge)
                VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    order_id, line["denomination"], line["quantity"], line["face_value"],
                    line["pricing_rule_id"], line["charge_type"], line["rate"], line["service_charge"],
                ),
            )
        for charge in additional_charges:
            connection.execute(
                "INSERT INTO order_charge (order_id, charge_name, price) VALUES (%s, %s, %s)",
                (order_id, charge["charge_name"], charge["price"]),
            )

        connection.execute(
            "UPDATE b2b_estamp_bulk_order SET total_face_value = %s, total_quantity = %s, updated_at = now() WHERE order_id = %s",
            (total_face_value, total_quantity, order_id),
        )
        connection.execute(
            "UPDATE orders SET amount = %s, quantity = %s, updated_at = now() WHERE id = %s",
            (final_total, total_quantity, order_id),
        )

        # Re-blocks against the corrected face value — releases whatever was
        # blocked before (0 the first time this runs, for an eStamp/KASCoSA
        # order that had none at creation) and blocks the new figure, so the
        # reservation never drifts from the actual stamp value this order
        # will debit at Completed.
        if (order["payment_mode"] or "Wallet") != "PPS":
            if float(order["wallet_blocked_amount"]) > 0:
                _release_wallet_block(
                    connection, organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
                    amount=float(order["wallet_blocked_amount"]), order_id=order_id,
                )
            if total_face_value > 0:
                _block_wallet_amount(
                    connection,
                    organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
                    amount=total_face_value, order_id=order_id,
                    description=f"Order {order['order_no']} · {BULK_ESTAMP_SERVICE_NAME} · Stamp Value (blocked, denomination updated)",
                )

    return get_bulk_estamp_order_admin(order_id)


def _auto_generate_wallet_reimbursement_invoices_on_completion(
    *, order_id: UUID, organization_id: UUID, organization_user_id: UUID | None,
) -> None:
    """Companion to _auto_generate_bulk_estamp_invoice_on_completion: any
    wallet credit that was raised specifically to cover this order's balance
    (wallet_transactions.order_id / organization_user_wallet_transactions.
    order_id — see schema.sql) gets its own Reimbursement invoice generated
    the moment the order reaches Completed too, same as the order's own
    invoice — so there is never a lingering "Pending, needs Generate Invoice"
    wallet-reimbursement row for something that's already part of a completed
    order. Idempotent (get_or_create_reimbursement_invoice_for_wallet_credit's
    own existing-row check) and never raises, matching the sibling function's
    failure-mode reasoning: worst case, Super Admin generates it manually
    afterwards from Order Reports exactly like before this existed.
    """
    from app.invoice_service import get_or_create_reimbursement_invoice_for_wallet_credit

    try:
        with get_transaction() as connection:
            org_credits = connection.execute(
                "SELECT id, amount FROM wallet_transactions WHERE order_id = %s AND type = 'credit'",
                (order_id,),
            ).fetchall()
            for credit in org_credits:
                get_or_create_reimbursement_invoice_for_wallet_credit(
                    connection, organization_id=organization_id, organization_user_id=None,
                    amount=credit["amount"], wallet_transaction_id=credit["id"],
                )

            member_credits = connection.execute(
                "SELECT id, amount FROM organization_user_wallet_transactions WHERE order_id = %s AND type = 'credit'",
                (order_id,),
            ).fetchall()
            for credit in member_credits:
                get_or_create_reimbursement_invoice_for_wallet_credit(
                    connection, organization_id=organization_id, organization_user_id=organization_user_id,
                    amount=credit["amount"], organization_user_wallet_transaction_id=credit["id"],
                )
    except Exception:
        logger.exception(
            "Auto reimbursement-invoice generation failed for eStamp Bulk order %s's linked wallet "
            "credits after reaching Completed — they can still be generated manually from Order Reports.",
            order_id,
        )


def _auto_generate_bulk_estamp_invoice_on_completion(*, order_id: UUID, organization_id: UUID, organization_user_id: UUID | None) -> None:
    """The moment an eStamp Bulk order reaches Completed, generate its
    normal/service invoice right away — same immediacy as eSign's completion
    hook (see esign_service._auto_generate_invoice_on_completion) — instead
    of only ever creating it lazily on first Download Invoice click. Called
    after the status-transition transaction above has already committed, so
    invoice_service._resolve_order_invoice's Completed gate sees the real,
    already-persisted status. Idempotent via get_or_create_invoice_for_order's
    own existing-row check; never raises, since a failure here must never
    break the admin's status-update request that triggered it — worst case,
    the invoice still generates lazily on first manual download, exactly as
    it always could.
    """
    from app.invoice_service import get_or_create_invoice_for_order

    try:
        get_or_create_invoice_for_order(
            order_id=order_id, organization_id=organization_id, organization_user_id=organization_user_id,
            charge_wallet=True,
        )
    except Exception:
        logger.exception(
            "Auto invoice generation failed for eStamp Bulk order %s after reaching Completed — "
            "it will still generate lazily on first manual download.",
            order_id,
        )


# =========================================
# MANUAL ESTAMP
#
# Another separate, internally-processed service — no SignDesk stamp API
# call; Super Admin arranges the physical/manual stamping outside the system
# and uploads the resulting stamped copy here. Has its own richer status
# flow (unlike eStamp Bulk's plain linear one) because it branches on
# whether eSign was requested, and — when it was — the eSign leg reuses the
# generic eSign machinery in esign_service.py rather than a separate one
# (see that module's Manual eStamp branches in _get_order_for_esign /
# _get_esign_source_pdf, and its completion hook in _apply_signer_status).
# =========================================

MANUAL_ESTAMP_SERVICE_NAME = "Manual eStamp"

MANUAL_ESTAMP_STATUS_SUBMITTED = "Submitted"
MANUAL_ESTAMP_STATUS_STAMP_PROCESSING = "Stamp Processing"
MANUAL_ESTAMP_STATUS_STAMP_COMPLETED = "Stamp Completed"
MANUAL_ESTAMP_STATUS_ESIGN_PENDING = "eSign Pending"
MANUAL_ESTAMP_STATUS_ESIGN_COMPLETED = "eSign Completed"
MANUAL_ESTAMP_STATUS_COMPLETED = "Completed"

def _manual_estamp_admin_next_status(order: dict[str, Any]) -> str | None:
    """The single status a plain "just move it forward" admin action
    (update_manual_estamp_order_status) may set next, or None if the current
    status has no such transition at all — either because it needs a
    dedicated action instead (upload_manual_estamp_stamped_document,
    send_manual_estamp_for_esign), or because it only ever advances
    automatically (eSign Pending -> eSign Completed, once every signer
    finishes — see esign_service._apply_signer_status's Manual eStamp hook).
    Stamp Completed branches on esign_required: straight to Completed if no
    eSign was requested, otherwise only via send_manual_estamp_for_esign."""
    status = order["status"]
    if status == MANUAL_ESTAMP_STATUS_SUBMITTED:
        return MANUAL_ESTAMP_STATUS_STAMP_PROCESSING
    if status == MANUAL_ESTAMP_STATUS_STAMP_COMPLETED and not order["esign_required"]:
        return MANUAL_ESTAMP_STATUS_COMPLETED
    if status == MANUAL_ESTAMP_STATUS_ESIGN_COMPLETED:
        return MANUAL_ESTAMP_STATUS_COMPLETED
    return None


def get_manual_estamp_order_detail(order_id: UUID, *, connection=None) -> dict[str, Any] | None:
    """The manual-eStamp-specific data for an order — None if this order has
    no manual_estamp satellite row. Mirrors get_bulk_estamp_order_detail."""

    def _fetch(conn) -> dict[str, Any] | None:
        satellite = conn.execute(
            """
            SELECT m.stamp_state_id, s.state_name AS stamp_state_label, m.stamp_amount, m.service_fee,
                   m.esign_required, m.esign_signers, m.stamped_document_path,
                   m.delivery_full_name, m.delivery_mobile, m.delivery_address_line1, m.delivery_address_line2,
                   m.delivery_city, m.delivery_state, m.delivery_pincode
            FROM b2b_manual_estamp_order m
            JOIN state s ON s.id = m.stamp_state_id
            WHERE m.order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not satellite:
            return None
        charges = conn.execute(
            "SELECT charge_name, price FROM order_charge WHERE order_id = %s ORDER BY charge_name ASC",
            (order_id,),
        ).fetchall()
        # Plain existence check, never creates one — same reasoning as
        # get_bulk_estamp_order_detail's invoice_number field.
        invoice = conn.execute(
            "SELECT invoice_number FROM b2b_invoices WHERE order_id = %s", (order_id,)
        ).fetchone()
        return {**satellite, "charges": charges, "invoice_number": invoice["invoice_number"] if invoice else None}

    if connection is not None:
        return _fetch(connection)
    with get_connection() as connection:
        return _fetch(connection)


def create_manual_estamp_order(
    *,
    organization_id: UUID,
    # Optional — required for the User Portal's own creation (always the
    # calling member's own id), but a Partner can also place this order
    # org-wide with no specific "Created For" user, same as the generic
    # /orders endpoint (_create_order) already allows.
    organization_user_id: UUID | None,
    customer_name: str,
    customer_email: str,
    customer_mobile: str,
    document: UploadFile,
    stamp_state_id: UUID,
    stamp_amount: float,
    esign_required: bool,
    esign_signers: list[dict[str, Any]],
    delivery_address: dict[str, Any] | None,
) -> dict[str, Any]:
    if MANUAL_ESTAMP_SERVICE_NAME not in get_active_service_names():
        raise HTTPException(status_code=400, detail=f"Unknown service '{MANUAL_ESTAMP_SERVICE_NAME}'")
    try:
        validate_mobile(customer_mobile)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if stamp_amount <= 0:
        raise HTTPException(status_code=400, detail="Stamp amount must be greater than 0")
    if esign_required and not esign_signers:
        raise HTTPException(status_code=400, detail="At least one eSign signer is required")

    with get_connection() as connection:
        pricing = connection.execute(
            "SELECT is_active, price FROM organization_service_pricing WHERE organization_id = %s AND service_name = %s",
            (organization_id, MANUAL_ESTAMP_SERVICE_NAME),
        ).fetchone()
        if not pricing or not pricing["is_active"]:
            raise HTTPException(
                status_code=400,
                detail=f"'{MANUAL_ESTAMP_SERVICE_NAME}' is not enabled for your account. Contact Super Admin.",
            )

        organization = connection.execute(
            "SELECT organization_type, payment_mode FROM organizations WHERE id = %s",
            (organization_id,),
        ).fetchone()

        # Same rule _create_order enforces for the generic /orders endpoint:
        # assignment is only checked when a specific "Created For" user was
        # actually given — a Partner placing this org-wide (no user picked)
        # skips it entirely, same as every other service already does.
        # Dealer orgs that DO name a user still require an explicit
        # per-member assignment; a Retailer's single member login IS the
        # organization, so it never needs one regardless.
        if organization_user_id is not None and organization["organization_type"] != "Retailer":
            assigned = connection.execute(
                """
                SELECT 1 FROM partner_user_services pus
                JOIN organization_service_pricing sp ON sp.id = pus.service_pricing_id
                WHERE pus.organization_user_id = %s AND sp.organization_id = %s AND sp.service_name = %s
                LIMIT 1
                """,
                (organization_user_id, organization_id, MANUAL_ESTAMP_SERVICE_NAME),
            ).fetchone()
            if not assigned:
                raise HTTPException(
                    status_code=403,
                    detail=f"'{MANUAL_ESTAMP_SERVICE_NAME}' is not assigned to your account",
                )

        state = connection.execute("SELECT id FROM state WHERE id = %s", (stamp_state_id,)).fetchone()
        if not state:
            raise HTTPException(status_code=400, detail="Invalid stamp state")

        # This organization's own additional charges assigned to Manual
        # eStamp (organization_service_charge_pricing) — same per-service
        # model create_bulk_estamp_order uses, never trusted from the
        # client. "Delivery Charge" specifically gates whether a delivery
        # address is required, same rule the frontend form enforces.
        assigned_charges = connection.execute(
            """
            SELECT charge_name, price FROM organization_service_charge_pricing
            WHERE organization_id = %s AND service_name = %s AND is_active = true
            """,
            (organization_id, MANUAL_ESTAMP_SERVICE_NAME),
        ).fetchall()
        active_charges = [
            {"charge_name": row["charge_name"], "price": float(row["price"] or 0)} for row in assigned_charges
        ]
        has_delivery_charge = any(c["charge_name"] == "Delivery Charge" for c in active_charges)

        if has_delivery_charge:
            if not delivery_address:
                raise HTTPException(status_code=400, detail="Delivery address is required for this account")
            try:
                validate_mobile(delivery_address["mobile"])
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

        esign_price_per_signer = None
        if esign_required:
            esign_pricing = connection.execute(
                "SELECT is_active, price FROM organization_service_pricing WHERE organization_id = %s AND service_name = 'eSign'",
                (organization_id,),
            ).fetchone()
            if not esign_pricing or not esign_pricing["is_active"]:
                raise HTTPException(status_code=400, detail="eSign is not enabled for your account. Contact Super Admin.")
            esign_price_per_signer = float(esign_pricing["price"] or 0)

    service_fee = float(pricing["price"] or 0)
    charges_total = sum(float(c["price"] or 0) for c in active_charges)
    esign_total = (esign_price_per_signer * len(esign_signers)) if esign_required else 0.0
    final_total = stamp_amount + service_fee + charges_total + esign_total

    raw_bytes = document.file.read()
    try:
        validate_safe_pdf_bytes(raw_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    display_filename = safe_stored_pdf_filename(document.filename)

    upload_dir = _order_upload_dir()
    stored_name = f"{uuid4()}.pdf"
    with open(upload_dir / stored_name, "wb") as f:
        f.write(raw_bytes)

    with get_transaction() as connection:
        seq = connection.execute("SELECT nextval('orders_order_no_seq') AS n").fetchone()
        order_no = f"ORD-{seq['n']:06d}"
        order = connection.execute(
            """
            INSERT INTO orders (
                order_no, organization_id, organization_user_id, customer_name, customer_email, customer_mobile,
                service_name, document_filename, document_path, amount, quantity, status,
                esign_price_per_signer, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s, %s, now())
            RETURNING id, order_no, organization_id, organization_user_id, customer_name, customer_email,
                      customer_mobile, service_name, amount, quantity, status, created_at, updated_at
            """,
            (
                order_no, organization_id, organization_user_id, customer_name, str(customer_email), customer_mobile,
                MANUAL_ESTAMP_SERVICE_NAME, display_filename, stored_name, final_total,
                MANUAL_ESTAMP_STATUS_SUBMITTED, esign_price_per_signer,
            ),
        ).fetchone()

        connection.execute(
            """
            INSERT INTO b2b_manual_estamp_order (
                order_id, stamp_state_id, stamp_amount, service_fee, esign_required, esign_signers,
                delivery_full_name, delivery_mobile, delivery_address_line1, delivery_address_line2,
                delivery_city, delivery_state, delivery_pincode
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                order["id"], stamp_state_id, stamp_amount, service_fee, esign_required,
                Jsonb(esign_signers) if esign_required else None,
                delivery_address["full_name"] if has_delivery_charge else None,
                delivery_address["mobile"] if has_delivery_charge else None,
                delivery_address["address_line1"] if has_delivery_charge else None,
                delivery_address.get("address_line2") if has_delivery_charge else None,
                delivery_address["city"] if has_delivery_charge else None,
                delivery_address["state"] if has_delivery_charge else None,
                delivery_address["pincode"] if has_delivery_charge else None,
            ),
        )

        # Authoritative snapshot of every org-wide charge actually applied at
        # order-creation time — same reasoning as create_bulk_estamp_order's
        # order_charge snapshot, so a later Super Admin config change never
        # retroactively alters this order's total or invoice. service_fee is
        # NOT snapshotted here — it lives on b2b_manual_estamp_order.service_fee
        # instead, same split as b2b_estamp_bulk_order.
        for charge in active_charges:
            connection.execute(
                "INSERT INTO order_charge (order_id, charge_name, price) VALUES (%s, %s, %s)",
                (order["id"], charge["charge_name"], float(charge["price"] or 0)),
            )

        # Blocks the stamp amount only — service_fee/charges/eSign are the
        # "service charge", never blocked, deducted separately at Generate
        # Invoice time instead (see invoice_service.get_or_create_invoice_
        # for_order's charge_wallet param). Converted to a real debit at
        # Completed (see update_manual_estamp_order_status), same shape as
        # eStamp Bulk's create_bulk_estamp_order.
        if (organization["payment_mode"] or "Wallet") != "PPS":
            _block_wallet_amount(
                connection,
                organization_id=organization_id, organization_user_id=organization_user_id,
                amount=stamp_amount, order_id=order["id"],
                description=f"Order {order_no} · {MANUAL_ESTAMP_SERVICE_NAME} · Stamp Value (blocked)",
            )

    notify_new_order(order)

    order["manual_estamp"] = get_manual_estamp_order_detail(order["id"])
    return order


def get_manual_estamp_order_admin(order_id: UUID) -> dict[str, Any]:
    """Super Admin's order detail — unlike get_partner_order_with_esign, not
    scoped to a specific organization (admin can view any partner's order).
    Includes the eSign sub-object (signer progress) when esign_required, same
    as the partner-facing detail — Admin needs this to know whether it's safe
    to click "Mark Order Completed" from eSign Completed."""
    with get_connection() as connection:
        order = connection.execute(
            """
            SELECT o.id, o.order_no, o.organization_id, org.organization_name AS partner_name,
                   o.organization_user_id, COALESCE(u.full_name, org.organization_name) AS created_by,
                   o.customer_name, o.customer_email, o.customer_mobile,
                   o.service_name, o.amount, o.quantity, o.status, o.created_at, o.updated_at,
                   o.esign_price_per_signer
            FROM orders o
            JOIN organizations org ON org.id = o.organization_id
            LEFT JOIN organization_users ou ON ou.id = o.organization_user_id
            LEFT JOIN users u ON u.id = ou.user_id
            WHERE o.id = %s
            """,
            (order_id,),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["service_name"] != MANUAL_ESTAMP_SERVICE_NAME:
            raise HTTPException(status_code=400, detail="Not a Manual eStamp order")

        manual = get_manual_estamp_order_detail(order_id, connection=connection)
        order["manual_estamp"] = manual
        price_per_signer_input = order.pop("esign_price_per_signer")
        if manual and manual["esign_required"]:
            order["esign"] = _build_esign_subobject(
                connection, order_id=order_id, esign_price_per_signer=price_per_signer_input,
                amount=order["amount"], quantity=order["quantity"],
            )
    return order


def _load_manual_estamp_order_for_admin_action(connection, order_id: UUID) -> dict[str, Any]:
    order = connection.execute(
        """
        SELECT o.id, o.status, o.service_name, o.order_no, o.organization_id, o.organization_user_id,
               o.stamp_value_wallet_debited, o.wallet_blocked_amount, org.payment_mode,
               m.stamp_amount, m.esign_required, m.esign_signers, m.stamped_document_path
        FROM orders o
        JOIN organizations org ON org.id = o.organization_id
        JOIN b2b_manual_estamp_order m ON m.order_id = o.id
        WHERE o.id = %s
        FOR UPDATE OF o
        """,
        (order_id,),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["service_name"] != MANUAL_ESTAMP_SERVICE_NAME:
        raise HTTPException(status_code=400, detail="Not a Manual eStamp order")
    return order


def _debit_manual_estamp_stamp_value(connection, order: dict[str, Any]) -> None:
    """Converts the stamp amount's placement-time block (see
    create_manual_estamp_order) into a real debit — never the service fee,
    additional charges, or eSign charge, which are the "service charge",
    deducted separately at Generate Invoice time instead — exactly once,
    the moment the order reaches Completed. Same guard/reasoning as eStamp
    Bulk's Completed-triggered conversion in update_bulk_estamp_order_status."""
    if order["stamp_value_wallet_debited"] or (order["payment_mode"] or "Wallet") == "PPS":
        return
    _convert_block_to_debit(
        connection,
        organization_id=order["organization_id"],
        organization_user_id=order["organization_user_id"],
        amount=float(order["stamp_amount"]),
        order_id=order["id"],
        description=f"Order {order['order_no']} · {MANUAL_ESTAMP_SERVICE_NAME} · Stamp Value",
    )
    connection.execute(
        "UPDATE orders SET stamp_value_wallet_debited = true WHERE id = %s",
        (order["id"],),
    )


def update_manual_estamp_order_status(order_id: UUID, new_status: str) -> dict[str, Any]:
    """Plain 'move it forward' admin action — only valid for the transitions
    _manual_estamp_admin_next_status allows. Every other transition goes
    through its own dedicated action instead (see
    upload_manual_estamp_stamped_document, send_manual_estamp_for_esign) or
    happens automatically (eSign Pending -> eSign Completed)."""
    with get_transaction() as connection:
        order = _load_manual_estamp_order_for_admin_action(connection, order_id)

        allowed = _manual_estamp_admin_next_status(order)
        if allowed != new_status:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot move from '{order['status']}' to '{new_status}'. "
                    + (f"Next allowed status is '{allowed}'." if allowed else "No admin-triggered transition is available from this status.")
                ),
            )

        connection.execute(
            "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
            (new_status, order_id),
        )
        if new_status == MANUAL_ESTAMP_STATUS_COMPLETED:
            _debit_manual_estamp_stamp_value(connection, order)

    if new_status == MANUAL_ESTAMP_STATUS_COMPLETED:
        _auto_generate_manual_estamp_invoice_on_completion(
            order_id=order_id, organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
        )
        notify_order_completed(
            organization_id=order["organization_id"], order_id=order_id,
            order_no=order["order_no"], service_name=order["service_name"],
            organization_user_id=order["organization_user_id"],
        )

    return get_manual_estamp_order_admin(order_id)


def cancel_manual_estamp_order(order_id: UUID, reason: str | None = None) -> dict[str, Any]:
    """Admin-only cancel for a Manual eStamp order at any stage before
    Completed — releases whatever stamp value is currently blocked (see
    create_manual_estamp_order) back to available balance and marks the
    order Cancelled. Never allowed once Completed — by then the wallet's
    already been debited for real, same reasoning as
    cancel_bulk_estamp_order. `reason` optional for the same reason noted
    there — reports.cancel_order_report is the caller that requires one."""
    with get_transaction() as connection:
        order = _load_manual_estamp_order_for_admin_action(connection, order_id)
        if order["status"] == MANUAL_ESTAMP_STATUS_COMPLETED:
            raise HTTPException(status_code=400, detail="Cannot cancel an order that is already Completed")

        if float(order["wallet_blocked_amount"]) > 0:
            _release_wallet_block(
                connection,
                organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
                amount=float(order["wallet_blocked_amount"]), order_id=order_id,
            )

        connection.execute(
            "UPDATE orders SET status = 'Cancelled', cancellation_reason = %s, updated_at = now() WHERE id = %s",
            (reason, order_id),
        )

    return get_manual_estamp_order_admin(order_id)


def _auto_generate_manual_estamp_invoice_on_completion(*, order_id: UUID, organization_id: UUID, organization_user_id: UUID | None) -> None:
    """The moment a Manual eStamp order reaches Completed, generate its
    normal/service invoice right away — same immediacy as eStamp Bulk's
    completion hook (see _auto_generate_bulk_estamp_invoice_on_completion)
    and eSign's (see esign_service._auto_generate_invoice_on_completion) —
    instead of only ever creating it lazily on first Download Invoice click.
    Called after the status-transition transaction above has already
    committed, so invoice_service._resolve_order_invoice's Completed gate
    sees the real, already-persisted status. Idempotent via
    get_or_create_invoice_for_order's own existing-row check; never raises,
    since a failure here must never break the admin's status-update request
    that triggered it — worst case, the invoice still generates lazily on
    first manual download.
    """
    from app.invoice_service import get_or_create_invoice_for_order

    try:
        get_or_create_invoice_for_order(
            order_id=order_id, organization_id=organization_id, organization_user_id=organization_user_id,
            charge_wallet=True,
        )
    except Exception:
        logger.exception(
            "Auto invoice generation failed for Manual eStamp order %s after reaching Completed — "
            "it will still generate lazily on first manual download.",
            order_id,
        )


def upload_manual_estamp_stamped_document(order_id: UUID, file: UploadFile) -> dict[str, Any]:
    """Super Admin uploads the manually-stamped copy once the physical
    stamping is done outside the system — Stamp Processing -> Stamp
    Completed. If eSign wasn't requested, Completed (and the wallet debit)
    is a separate explicit action after this, same as when it was requested
    — this endpoint only ever records the stamped document."""
    from app.stamp_service import STAMPED_UPLOAD_DIR

    with get_transaction() as connection:
        order = _load_manual_estamp_order_for_admin_action(connection, order_id)
        if order["status"] != MANUAL_ESTAMP_STATUS_STAMP_PROCESSING:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot upload a stamped document from status '{order['status']}' — order must be in '{MANUAL_ESTAMP_STATUS_STAMP_PROCESSING}'.",
            )

        STAMPED_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        raw_bytes = file.file.read()
        try:
            validate_safe_pdf_bytes(raw_bytes)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        stored_name = f"{uuid4()}.pdf"
        with open(STAMPED_UPLOAD_DIR / stored_name, "wb") as f:
            f.write(raw_bytes)

        connection.execute(
            "UPDATE b2b_manual_estamp_order SET stamped_document_path = %s, updated_at = now() WHERE order_id = %s",
            (stored_name, order_id),
        )
        connection.execute(
            "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
            (MANUAL_ESTAMP_STATUS_STAMP_COMPLETED, order_id),
        )

    return get_manual_estamp_order_admin(order_id)


def send_manual_estamp_for_esign(order_id: UUID) -> dict[str, Any]:
    """Super Admin sends the stamped copy for signature — Stamp Completed ->
    eSign Pending. Only valid when esign_required, using exactly the signers
    captured at order creation (esign_signers) so Admin doesn't re-enter
    them. Reuses the generic eSign integration (initiate_esign) — see
    esign_service.py's Manual eStamp branches for how it signs the stamped
    copy instead of the original upload."""
    from app.esign_service import SignerIn, initiate_esign

    with get_connection() as connection:
        order = _load_manual_estamp_order_for_admin_action(connection, order_id)

    if not order["esign_required"]:
        raise HTTPException(status_code=400, detail="This order was not created with eSign requested")
    if order["status"] != MANUAL_ESTAMP_STATUS_STAMP_COMPLETED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot send for eSign from status '{order['status']}' — order must be in '{MANUAL_ESTAMP_STATUS_STAMP_COMPLETED}'.",
        )

    signers = [SignerIn(**s) for s in (order["esign_signers"] or [])]
    initiate_esign(order_id=order_id, organization_id=order["organization_id"], signers=signers)

    with get_transaction() as connection:
        connection.execute(
            "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
            (MANUAL_ESTAMP_STATUS_ESIGN_PENDING, order_id),
        )

    return get_manual_estamp_order_admin(order_id)


def get_manual_estamp_stamped_file_path(*, order_id: UUID, organization_id: UUID) -> Path:
    """The manually-stamped copy Super Admin uploaded (see
    upload_manual_estamp_stamped_document) — org-scoped, for the Partner
    User's own document preview/download, mirroring
    stamp_service.get_stamped_file_path's single-eStamp equivalent."""
    from app.stamp_service import STAMPED_UPLOAD_DIR

    with get_connection() as connection:
        order = connection.execute(
            "SELECT id FROM orders WHERE id = %s AND organization_id = %s AND service_name = %s",
            (order_id, organization_id, MANUAL_ESTAMP_SERVICE_NAME),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        manual = connection.execute(
            "SELECT stamped_document_path FROM b2b_manual_estamp_order WHERE order_id = %s", (order_id,),
        ).fetchone()

    if not manual or not manual["stamped_document_path"]:
        raise HTTPException(status_code=404, detail="Stamped document is not available yet")

    path = STAMPED_UPLOAD_DIR / manual["stamped_document_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stamped document file is missing on the server")
    return path


@router.post("/orders/manual-estamp", status_code=201)
async def create_partner_manual_estamp_order(
    customer_name: str = Form(...),
    customer_email: EmailStr = Form(...),
    customer_mobile: str = Form(...),
    stamp_state_id: UUID = Form(...),
    stamp_amount: float = Form(...),
    esign_required: bool = Form(False),
    esign_signers: str = Form("[]"),
    delivery_address: str | None = Form(None),
    document: UploadFile = File(...),
    # Optional — same "Created For (Optional)" pattern as the generic
    # /orders endpoint: a Partner can attribute this to one of their users,
    # or leave it org-wide.
    organization_user_id: UUID | None = Form(None),
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    try:
        signers = [ManualEstampSignerIn(**s).model_dump() for s in json.loads(esign_signers)]
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid esign_signers: {e}") from e

    parsed_delivery_address = None
    if delivery_address:
        try:
            parsed_delivery_address = ManualEstampDeliveryAddressIn(**json.loads(delivery_address)).model_dump()
        except (json.JSONDecodeError, ValidationError, TypeError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid delivery_address: {e}") from e

    return create_manual_estamp_order(
        organization_id=current_partner["organization_id"],
        organization_user_id=organization_user_id,
        customer_name=customer_name,
        customer_email=str(customer_email),
        customer_mobile=customer_mobile,
        document=document,
        stamp_state_id=stamp_state_id,
        stamp_amount=stamp_amount,
        esign_required=esign_required,
        esign_signers=signers,
        delivery_address=parsed_delivery_address,
    )


@router.get("/estamp-bulk-pricing-rules")
def list_partner_bulk_estamp_pricing_rules(
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    rules = list_bulk_estamp_pricing_rules(current_partner["organization_id"])
    return [r for r in rules if r["is_active"]]


@router.get("/article-codes")
def list_partner_article_codes(
    state_id: UUID | None = None,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    # Scoped to the selected Stamp State (see PartnerCreateEstampBulk.jsx) —
    # a code configured for another state must never show up here.
    return get_active_article_codes(state_id)


@router.post("/orders/estamp-bulk", status_code=201)
def create_partner_bulk_estamp_order(
    payload: BulkEstampOrderCreate,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return create_bulk_estamp_order(
        organization_id=current_partner["organization_id"],
        organization_user_id=payload.organization_user_id,
        customer_name=payload.customer_name,
        customer_email=str(payload.customer_email) if payload.customer_email else None,
        customer_mobile=payload.customer_mobile,
        stamp_state_id=payload.stamp_state_id,
        items=[item.model_dump() for item in payload.items],
        delivery_address=payload.delivery_address.model_dump(),
        party_details=payload.party_details.model_dump(),
        consideration_amount=payload.consideration_amount,
        article_code_id=payload.article_code_id,
    )


@router.get("/orders/{order_id}/document/manual-stamped-preview")
def preview_partner_manual_estamp_stamped_document(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> FileResponse:
    path = get_manual_estamp_stamped_file_path(order_id=order_id, organization_id=current_partner["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


def _build_esign_subobject(connection, *, order_id: UUID, esign_price_per_signer, amount, quantity) -> dict[str, Any]:
    """The full signer timeline + workflow summary for an order's eSign
    workflow — shared by plain "eSign" orders and "Manual eStamp" orders with
    esign_required (see get_partner_order_with_esign), since both reuse the
    exact same b2b_esign_transaction/b2b_esign_signer tables."""
    # Always the latest version, whether it's the currently active one,
    # fully completed, or explicitly cancelled with no replacement — so
    # "Cancelled" has something concrete (the frozen signer list as it
    # stood at cancellation) to show instead of just disappearing.
    transaction = connection.execute(
        "SELECT id, version, is_active, docket_id, document_id, status, cancellation_reason, signed_file_path, created_at "
        "FROM b2b_esign_transaction WHERE order_id = %s ORDER BY version DESC LIMIT 1",
        (order_id,),
    ).fetchone()
    signers = (
        connection.execute(
            """
            SELECT id, signer_name, signer_email, signer_mobile, sequence, status,
                   opened_at, signed_at, ip_address, device_info, wallet_debited, last_reminder_sent_at,
                   created_at AS sent_at
            FROM b2b_esign_signer WHERE transaction_id = %s ORDER BY sequence NULLS LAST, created_at
            """,
            (transaction["id"],),
        ).fetchall()
        if transaction
        else []
    )

    total = len(signers)
    signed = sum(1 for s in signers if s["status"] == "signed")
    counts = {
        "total": total,
        "signed": signed,
        "pending": sum(1 for s in signers if s["status"] in ("pending", "sent")),
        "rejected": sum(1 for s in signers if s["status"] == "rejected"),
        "expired": sum(1 for s in signers if s["status"] == "expired"),
        "failed": sum(1 for s in signers if s["status"] == "failed"),
        "cancelled": sum(1 for s in signers if s["status"] == "cancelled"),
    }
    all_terminal = bool(signers) and all(
        s["status"] in ("signed", "rejected", "expired", "failed", "cancelled") for s in signers
    )
    workflow_completed = max((s["signed_at"] for s in signers if s["signed_at"]), default=None) if all_terminal else None
    price_per_signer = _effective_esign_price_per_signer(
        esign_price_per_signer=esign_price_per_signer, amount=amount, quantity=quantity,
    )

    return {
        "version": transaction["version"] if transaction else None,
        "is_active": transaction["is_active"] if transaction else None,
        "status_label": _esign_status_label(
            transaction_status=transaction["status"] if transaction else None, signed=signed, total=total,
        ),
        # Charged Amount / Total Amount — Total stays order.amount
        # (price × signer count, computed at creation, unaffected by
        # later completions); Charged reflects only what's actually been
        # debited so far (see esign_service.record_callback, which bills
        # per signer on their individual 'signed' transition) — the same
        # calculation as list_partner_orders, so this and the Order List
        # can never disagree.
        "charged_amount": round(price_per_signer * signed, 2),
        "docket_id": transaction["docket_id"] if transaction else None,
        "signed_file_path": transaction["signed_file_path"] if transaction else None,
        "cancellation_reason": transaction["cancellation_reason"] if transaction else None,
        "workflow_started": transaction["created_at"] if transaction else None,
        "workflow_completed": workflow_completed,
        "signers": signers,
        "summary": {**counts, "completion_pct": round(signed / total * 100, 1) if total else 0},
    }


def get_partner_order_with_esign(
    *,
    order_id: UUID,
    organization_id: UUID,
    organization_user_id: UUID | None = None,
) -> dict[str, Any]:
    """Order detail plus, for eSign orders (and Manual eStamp orders that
    requested eSign), the full signer timeline and a workflow summary — used
    by the Order Detail view (View button). When organization_user_id is
    given (Partner User portal), the order must belong to that specific
    member, not just the organization."""
    with get_connection() as connection:
        order = connection.execute(
            """
            SELECT o.id, o.order_no, o.organization_id, o.organization_user_id,
                   o.customer_name, o.customer_email, o.customer_mobile,
                   o.service_name, o.document_type, o.document_filename, o.document_path,
                   o.amount, o.quantity, o.status, o.created_at, o.updated_at, o.esign_price_per_signer,
                   o.stamp_value_wallet_debited,
                   COALESCE(u.full_name, org.organization_name) AS created_by
            FROM orders o
            JOIN organizations org ON org.id = o.organization_id
            LEFT JOIN organization_users ou ON ou.id = o.organization_user_id
            LEFT JOIN users u ON u.id = ou.user_id
            WHERE o.id = %(order_id)s AND o.organization_id = %(organization_id)s
              AND (%(organization_user_id)s::uuid IS NULL OR o.organization_user_id = %(organization_user_id)s::uuid)
            """,
            {"order_id": order_id, "organization_id": organization_id, "organization_user_id": organization_user_id},
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        if order["service_name"] == BULK_ESTAMP_SERVICE_NAME:
            order.pop("esign_price_per_signer", None)
            order["bulk_estamp"] = get_bulk_estamp_order_detail(order_id, connection=connection)
            return order

        if order["service_name"] == MANUAL_ESTAMP_SERVICE_NAME:
            manual = get_manual_estamp_order_detail(order_id, connection=connection)
            order["manual_estamp"] = manual
            price_per_signer_input = order.pop("esign_price_per_signer")
            if manual and manual["esign_required"]:
                order["esign"] = _build_esign_subobject(
                    connection, order_id=order_id, esign_price_per_signer=price_per_signer_input,
                    amount=order["amount"], quantity=order["quantity"],
                )
            return order

        if order["service_name"] == "eStamp":
            # A plain eStamp order can optionally have eSign attached
            # afterwards (see stamp_service.initiate_stamp /
            # esign_service.initiate_esign's "send for eSign after stamp"
            # option) — same b2b_esign_transaction/b2b_esign_signer tables
            # Manual eStamp's own combo case already reuses via
            # _build_esign_subobject, just detected dynamically here instead
            # of via a stored esign_required flag (eStamp orders don't have
            # one — whether eSign was requested is only ever knowable by
            # whether a transaction row actually exists).
            price_per_signer_input = order.pop("esign_price_per_signer")
            order["stamp"] = connection.execute(
                """
                SELECT status, reference_id, stamp_paper_number, stamp_duty_amount,
                       error_message, stamped_file_path, created_at, updated_at
                FROM b2b_stamp_transaction WHERE order_id = %s
                """,
                (order_id,),
            ).fetchone()
            has_esign = connection.execute(
                "SELECT 1 FROM b2b_esign_transaction WHERE order_id = %s", (order_id,)
            ).fetchone()
            if has_esign:
                order["esign"] = _build_esign_subobject(
                    connection, order_id=order_id, esign_price_per_signer=price_per_signer_input,
                    amount=order["amount"], quantity=order["quantity"],
                )
            return order

        if order["service_name"] == "eKYC":
            order.pop("esign_price_per_signer", None)
            # Real invoice/wallet-charge GST split for this order, computed
            # the exact same way get_or_create_invoice_for_order actually
            # would at invoicing time (_organization_bill_to/_is_karnataka/
            # _tax_split, same flat DEFAULT_GST_PERCENTAGE — see
            # invoice_service.py) but WITHOUT creating an invoice — eKYC's
            # invoice doesn't exist yet for an order still awaiting
            # DigiLocker/PAN verification, so the eKYC Verification screen
            # needs this as a live preview, not a read of an invoice row.
            # order["amount"] is the taxable base (never wallet-debited by
            # itself — see _tax_inclusive_total), so total_amount here is
            # exactly what charge_wallet=True will actually deduct.
            from app.invoice_service import DEFAULT_GST_PERCENTAGE, _organization_bill_to, _tax_split
            from app.routes.accounts import _is_karnataka

            bill_to = _organization_bill_to(connection, organization_id)
            karnataka = _is_karnataka(bill_to["state"])
            cgst_pct, sgst_pct, igst_pct = _tax_split(karnataka)
            service_amount = Decimal(str(order["amount"] or 0))
            cgst_amount = (service_amount * cgst_pct / 100).quantize(Decimal("0.01"))
            sgst_amount = (service_amount * sgst_pct / 100).quantize(Decimal("0.01"))
            igst_amount = (service_amount * igst_pct / 100).quantize(Decimal("0.01"))
            order["gst_breakup"] = {
                "is_karnataka": karnataka,
                "gst_percentage": float(DEFAULT_GST_PERCENTAGE),
                "service_amount": float(service_amount),
                "cgst_amount": float(cgst_amount),
                "sgst_amount": float(sgst_amount),
                "igst_amount": float(igst_amount),
                "total_amount": float(service_amount + cgst_amount + sgst_amount + igst_amount),
            }
            return order

        if order["service_name"] != "eSign":
            order.pop("esign_price_per_signer", None)
            return order

        order["esign"] = _build_esign_subobject(
            connection, order_id=order_id, esign_price_per_signer=order.pop("esign_price_per_signer"),
            amount=order["amount"], quantity=order["quantity"],
        )
        return order


# app.stamp_service imports _block_wallet_amount/_convert_block_to_debit/
# _release_wallet_block (defined above) back from this module — importing it
# at the top of this file would be circular, since those names don't exist
# yet that early in partner.py's own load. Imported here instead, after
# they're defined (same reasoning as esign_service.py's local imports of
# this module, marked "avoids a module-level circular import").
from app.stamp_service import StampInitiateRequest, get_stamped_file_path, initiate_stamp  # noqa: E402
from app.stamp_service import (  # noqa: E402
    StampOtfInitiateRequest,
    get_stamp_otf_file_path,
    get_stamp_otf_status,
    initiate_stamp_otf,
)

# Same reasoning — app.invoice_service imports BULK_ESTAMP_SERVICE_NAME and
# get_partner_order_with_esign (both defined above this point) back from
# this module at its own module level.
from app.invoice_service import (  # noqa: E402
    _invoice_belongs_to_org,
    download_invoice_pdf_for_order,
    download_invoice_pdf_for_org,
    get_order_pricing_preview,
    list_invoices_for_user,
)
from app.routes.accounts import get_invoice  # noqa: E402


@router.get("/orders/{order_id}/invoice/pdf")
def download_partner_order_invoice(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> StreamingResponse:
    return download_invoice_pdf_for_order(order_id=order_id, organization_id=current_partner["organization_id"])


# =========================================
# INVOICES — Partner Portal's own Invoices page, same Reimbursement/Service
# split as the User Portal's (see partner_user.list_my_invoices) but org-wide
# rather than scoped to one member: organization_user_id=None to
# list_invoices_for_user means "no member filter at all," which is exactly
# every invoice for this org regardless of which member's order it came
# from. Detail/PDF ownership uses _invoice_belongs_to_org for the same
# reason — see its docstring.
# =========================================


@router.get("/invoices")
def list_partner_invoices(current_partner: dict[str, Any] = Depends(get_current_partner)) -> list[dict[str, Any]]:
    return list_invoices_for_user(organization_id=current_partner["organization_id"], organization_user_id=None)


@router.get("/invoices/{invoice_id}")
def get_partner_invoice(
    invoice_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    invoice = get_invoice(invoice_id)
    if not _invoice_belongs_to_org(invoice, organization_id=current_partner["organization_id"]):
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.get("/invoices/{invoice_id}/pdf")
def download_partner_invoice(
    invoice_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> StreamingResponse:
    return download_invoice_pdf_for_org(invoice_id=invoice_id, organization_id=current_partner["organization_id"])


@router.get("/orders/{order_id}")
def get_partner_order(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]
    order = get_partner_order_with_esign(order_id=order_id, organization_id=organization_id)
    # Same original_pdf/signed_pdf/workflow_status contract as
    # partner_user.get_my_order — the Create Order result screen (and Order
    # Detail, once it exists for the Partner Portal) read these directly
    # rather than deriving them a second, possibly-inconsistent way.
    esign = order.get("esign")
    order["original_pdf"] = f"/api/partner/orders/{order_id}/document/preview" if order.get("document_path") else None
    order["signed_pdf"] = (
        f"/api/partner/orders/{order_id}/document/signed-preview"
        if esign and esign.get("signed_file_path")
        else None
    )
    order["workflow_status"] = esign["status_label"] if esign and esign.get("status_label") else order["status"]

    order["ekyc"] = None
    order["digilocker"] = None
    order["pan"] = None
    if order["service_name"] == "eKYC":
        try:
            order["ekyc"] = get_ekyc_status(order_id=order_id, organization_id=organization_id)
        except HTTPException:
            pass
        try:
            order["digilocker"] = get_digilocker_status(order_id=order_id, organization_id=organization_id)
        except HTTPException:
            pass
        if order["document_type"] == "pan_card":
            try:
                order["pan"] = get_pan_status(order_id=order_id, organization_id=organization_id)
            except HTTPException:
                pass

    order["pricing_preview"] = get_order_pricing_preview(organization_id=organization_id, order=order)

    return order


@router.get("/orders/{order_id}/document")
def download_partner_order_document(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> FileResponse:
    with get_connection() as connection:
        order = connection.execute(
            "SELECT document_path, document_filename FROM orders WHERE id = %s AND organization_id = %s",
            (order_id, current_partner["organization_id"]),
        ).fetchone()
    if not order or not order["document_path"]:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = _order_upload_dir() / order["document_path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file is missing on the server")

    return FileResponse(
        path=str(file_path),
        filename=order["document_filename"] or "document",
        media_type="application/octet-stream",
    )


@router.get("/orders/{order_id}/document/preview")
def preview_partner_order_document(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> FileResponse:
    """Same file as download_partner_order_document, but served inline for
    the Create Order result screen's PDF viewer — see partner_user.py's
    identical preview_my_order_document."""
    with get_connection() as connection:
        order = connection.execute(
            "SELECT document_path FROM orders WHERE id = %s AND organization_id = %s",
            (order_id, current_partner["organization_id"]),
        ).fetchone()
    if not order or not order["document_path"]:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = _order_upload_dir() / order["document_path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file is missing on the server")

    return _pdf_inline_response(file_path)


@router.get("/orders/{order_id}/document/signed-preview")
def preview_partner_order_signed_document(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> FileResponse:
    path = get_signed_file_path(order_id=order_id, organization_id=current_partner["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


@router.get("/orders/{order_id}/document/stamped-preview")
def preview_partner_order_stamped_document(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> FileResponse:
    path = get_stamped_file_path(order_id=order_id, organization_id=current_partner["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


@router.post("/orders/{order_id}/esign/initiate", status_code=201)
def initiate_partner_order_esign(
    order_id: UUID,
    body: EsignInitiateRequest,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return initiate_esign(order_id=order_id, organization_id=current_partner["organization_id"], signers=body.signers)


@router.post("/orders/{order_id}/stamp/initiate", status_code=201)
def initiate_partner_order_stamp(
    order_id: UUID,
    body: StampInitiateRequest,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return initiate_stamp(order_id=order_id, organization_id=current_partner["organization_id"], body=body)


# "eStamp On The Fly" (Karnataka) — same distinct path-segment reasoning as
# partner_user.py's trio. Also fills the GET /stamp/status gap plain eStamp
# has on this Partner-admin router (see partner_user.py, which has all
# three) — new code, no reason to carry the old asymmetry forward.
@router.post("/orders/{order_id}/stamp-otf/initiate", status_code=201)
def initiate_partner_order_stamp_otf(
    order_id: UUID,
    body: StampOtfInitiateRequest,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return initiate_stamp_otf(order_id=order_id, organization_id=current_partner["organization_id"], body=body)


@router.get("/orders/{order_id}/stamp-otf/status")
def get_partner_order_stamp_otf_status(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return get_stamp_otf_status(order_id=order_id, organization_id=current_partner["organization_id"])


@router.get("/orders/{order_id}/document/stamp-otf-preview")
def preview_partner_order_stamp_otf_document(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> FileResponse:
    path = get_stamp_otf_file_path(order_id=order_id, organization_id=current_partner["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


@router.post("/orders/{order_id}/ekyc/verify", status_code=201)
def verify_partner_order_ekyc(
    order_id: UUID,
    body: EkycVerifyRequest,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return initiate_ekyc(order_id=order_id, organization_id=current_partner["organization_id"], verification=body.verification)


@router.post("/orders/{order_id}/digilocker/verify", status_code=201)
def verify_partner_order_digilocker(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return initiate_digilocker(order_id=order_id, organization_id=current_partner["organization_id"])


@router.post("/orders/{order_id}/digilocker/fetch-aadhaar")
def fetch_partner_order_digilocker_aadhaar(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return fetch_aadhaar_details(order_id=order_id, organization_id=current_partner["organization_id"])


# =========================================
# BULK EKYC (.xlsx import) — see b2b_ekyc_bulk_batch/b2b_ekyc_bulk_record in
# schema.sql. A data-entry convenience layered on the eKYC flow above, never
# a separate priced service or a duplicate of its logic: "Initiate eKYC" on
# an imported row creates a REAL eKYC order through the exact same
# _create_order path above (with bulk_ekyc_record_id set), which atomically
# links that row to the order it produced. A record's status is never
# stored — see list_ekyc_bulk_records's CASE expression, which derives it
# fresh from the linked order's already-synced status every time.
#
# Shared with partner_user.py (the User Portal's identical Bulk eKYC
# screen) — organization_user_id is the only thing that differs between the
# two portals' calls (a Partner User's own membership vs. None/a partner-
# picked "Created For" user here), so every function below takes it as an
# explicit parameter rather than being tied to one portal's auth dependency.
# =========================================

# Header aliases are stored already-normalized (see _normalize_ekyc_bulk_header
# below) — lowercase, underscore-separated — so e.g. "Customer Email",
# "CUSTOMER EMAIL", "Customer_Email", and "customer email" all collapse to
# the same "customer_email" before this lookup ever runs; no need to list
# space/case variants here separately.
_EKYC_BULK_NAME_HEADERS = {"customer_name", "name", "full_name", "fullname"}
_EKYC_BULK_MOBILE_HEADERS = {"customer_mobile", "mobile", "phone", "phone_number", "mobile_number"}
_EKYC_BULK_EMAIL_HEADERS = {"customer_email", "email", "email_address"}
_EKYC_BULK_DOC_TYPE_HEADERS = {"document_type", "doc_type", "doctype"}
_EKYC_BULK_ACCOUNT_NUMBER_HEADERS = {"account_number", "acc_number", "account_no", "acc_no", "bank_account_number"}
# Recognized so it doesn't trip up header-matching, but never read — a
# record's status is always system-derived from its linked order (see
# list_ekyc_bulk_records), never trusted from the uploaded file.
_EKYC_BULK_STATUS_HEADERS = {"status"}
_EKYC_BULK_STATUS_VALUES = {"All", "Not Initiated", "In Progress", "Completed", "Failed"}

# User-facing labels for the required-column error message — never expose
# the internal snake_case field name to the admin (see
# _import_ekyc_bulk_excel's missing-columns check below). Email is
# deliberately not required here (nor collected on the Download Template
# at all) — it's filled in manually later at Initiate eKYC time if the
# eKYC form needs it. Account Number and Document Type ARE required —
# Account Number is also used to catch duplicate rows (see the dedupe
# check below).
_EKYC_BULK_REQUIRED_FIELD_LABELS = {
    "customer_name": "Customer Name",
    "customer_mobile": "Customer Mobile",
    "account_number": "Account Number",
    "doc_type": "Document Type",
}

_ekyc_bulk_email_adapter = TypeAdapter(EmailStr)
_ekyc_bulk_header_separator_re = re.compile(r"[\s_]+")

# Shown in the Download Template's Document Type dropdown and used to build
# that dropdown's validation list — kept separate from
# _normalize_ekyc_bulk_doc_type's loose substring matching (which still
# drives what an uploaded file's cell values are actually accepted as)
# because the template should only ever offer the exact values, never the
# wider set of free-text spellings that matcher tolerates on import.
_EKYC_BULK_DOC_TYPE_LABELS = {"aadhaar_card": "Aadhaar Card", "pan_card": "PAN Card"}
_EKYC_BULK_TEMPLATE_SHEET_NAME = "eKYC Bulk Template"
_EKYC_BULK_TEMPLATE_DATA_ROWS = 500  # how many rows the Document Type dropdown is pre-applied to


def _normalize_ekyc_bulk_header(header: str) -> str:
    """Case/whitespace/underscore-insensitive header normalization —
    'Customer Email', 'CUSTOMER EMAIL', 'Customer_Email', 'customer email',
    and 'customer_email' (and any run of spaces/underscores between words,
    however many) all normalize to the same 'customer_email' — so an
    admin's spreadsheet headers never have to match our internal field
    names exactly. See _map_ekyc_bulk_headers, the only caller."""
    return _ekyc_bulk_header_separator_re.sub("_", (header or "").strip().lower()).strip("_")


def _normalize_ekyc_bulk_doc_type(raw: str) -> str | None:
    """Maps a free-text 'Document Type' cell onto the same doc_type values
    the eKYC form's own dropdown uses (EKYC_DOC_TYPES in
    PartnerUserCreateOrder.jsx/PartnerCreateOrder.jsx) — accepts common
    spellings so an upload doesn't need to match the internal slug exactly
    (the Download Template's dropdown only ever offers
    _EKYC_BULK_DOC_TYPE_LABELS' exact values, but this stays permissive for
    hand-edited files). None for a blank cell — the caller in
    _import_ekyc_bulk_excel treats that as a required-field error, not a
    valid "decide later" value, so this only returns None internally
    before that check runs; raises ValueError for anything else
    unrecognized."""
    value = (raw or "").strip().lower()
    if not value:
        return None
    if "aadhaar" in value or "aadhar" in value:
        return "aadhaar_card"
    if "pan" in value:
        return "pan_card"
    raise ValueError(f"Unrecognized Document Type '{raw}' (expected Aadhaar or PAN)")


def _map_ekyc_bulk_headers(fieldnames: list[str] | None) -> dict[str, str]:
    """Maps this CSV's actual header row onto our canonical field names —
    {canonical_name: actual_header_as_written} — via _normalize_ekyc_bulk_header,
    so 'Customer Email', 'CUSTOMER EMAIL', 'Customer_Email', 'customer email',
    and 'customer_email' all resolve to the same canonical 'customer_email'
    regardless of the admin's exact capitalization/spacing/underscore choice."""
    mapping: dict[str, str] = {}
    for header in fieldnames or []:
        key = _normalize_ekyc_bulk_header(header)
        if key in _EKYC_BULK_NAME_HEADERS:
            mapping["customer_name"] = header
        elif key in _EKYC_BULK_MOBILE_HEADERS:
            mapping["customer_mobile"] = header
        elif key in _EKYC_BULK_EMAIL_HEADERS:
            mapping["customer_email"] = header
        elif key in _EKYC_BULK_DOC_TYPE_HEADERS:
            mapping["doc_type"] = header
        elif key in _EKYC_BULK_ACCOUNT_NUMBER_HEADERS:
            mapping["account_number"] = header
        elif key in _EKYC_BULK_STATUS_HEADERS:
            mapping["status"] = header
    return mapping


def _ekyc_bulk_cell_str(value: Any) -> str:
    """Normalizes an openpyxl cell value to plain text the same way a CSV
    reader would — Excel may store a "numeric-looking" cell (e.g. a mobile
    number typed without text formatting) as an int/float rather than a
    string, so this coerces those back to a plain digit string instead of
    leaving a stray trailing '.0'."""
    if value is None:
        return ""
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    return str(value).strip()


def _select_ekyc_bulk_data_worksheet(workbook):
    """The template's first sheet holds the data rows; its second is a
    read-only Instructions sheet (see _build_ekyc_bulk_template). Pick by
    name — falling back to the first sheet — so a reordered or renamed
    Instructions tab can never accidentally get read as the data sheet."""
    for worksheet in workbook.worksheets:
        if worksheet.title.strip().lower() != "instructions":
            return worksheet
    return workbook.worksheets[0]


def _build_ekyc_bulk_template() -> bytes:
    """Builds the .xlsx an admin downloads, fills in, and re-uploads via
    Import Excel. Headers are the same canonical labels _map_ekyc_bulk_headers
    already recognizes, and Document Type is restricted to a dropdown of
    _EKYC_BULK_DOC_TYPE_LABELS' values so a filled-in file can't contain a
    typo'd Document Type to begin with. No Email column — email isn't
    collected at import time (see _EKYC_BULK_REQUIRED_FIELD_LABELS), and
    Status is included read-only/for-reference only: _EKYC_BULK_STATUS_HEADERS
    recognizes that header so it doesn't trip up column matching, but its
    value is never read — status always starts as "Not Initiated" on import
    and is derived fresh from the linked order afterward."""
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = _EKYC_BULK_TEMPLATE_SHEET_NAME

    headers = ["Customer Name", "Mobile", "Document Type", "Account Number", "Status"]
    worksheet.append(headers)
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1E6091", end_color="1E6091", fill_type="solid")
    for col_index in range(1, len(headers) + 1):
        cell = worksheet.cell(row=1, column=col_index)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="left")
    for col_index, width in enumerate((28, 16, 20, 20, 18), start=1):
        worksheet.column_dimensions[get_column_letter(col_index)].width = width

    # allow_blank=False here is Excel-side reinforcement only — Excel's own
    # validation never blocks a cell nobody typed into, so the real
    # enforcement is still the "Document Type is required" row error in
    # _import_ekyc_bulk_excel. This just stops someone from clearing an
    # already-filled cell back to blank without Excel flagging it.
    doc_type_formula = '"{}"'.format(",".join(_EKYC_BULK_DOC_TYPE_LABELS.values()))
    validation = DataValidation(type="list", formula1=doc_type_formula, allow_blank=False, showErrorMessage=True)
    validation.error = "Document Type is required — please pick a value from the dropdown."
    validation.errorTitle = "Document Type Required"
    worksheet.add_data_validation(validation)
    validation.add(f"C2:C{_EKYC_BULK_TEMPLATE_DATA_ROWS + 1}")

    instructions = workbook.create_sheet("Instructions")
    instructions.column_dimensions["A"].width = 95
    instructions["A1"] = "Bulk eKYC Import — Instructions"
    instructions["A1"].font = Font(bold=True, size=13)
    for row_index, line in enumerate((
        "",
        f"1. Fill in one row per customer on the '{_EKYC_BULK_TEMPLATE_SHEET_NAME}' sheet.",
        "2. Customer Name, Mobile, Document Type and Account Number are required for every row.",
        "3. Mobile must be a valid 10-digit Indian mobile number.",
        "4. Document Type must be picked from the dropdown (Aadhaar Card or PAN Card).",
        "5. Account Number must be unique — a row with a Mobile or Account Number already used by "
        "another row (in this file, or a previously imported row not yet initiated) is skipped as a duplicate.",
        "6. Status is for your reference only — it's ignored on import. Every imported row starts as "
        "'Not Initiated' and updates automatically once you click Initiate eKYC for it.",
        "7. Do not rename, remove, or reorder the header row (row 1).",
        "8. Leave rows blank if you don't need them — blank rows are skipped automatically on import.",
        "9. Save the file as .xlsx and upload it back here using Import Excel.",
    ), start=2):
        instructions.cell(row=row_index, column=1, value=line)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def _import_ekyc_bulk_excel(
    *, file: UploadFile, organization_id: UUID, organization_user_id: UUID | None,
) -> dict[str, Any]:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload the .xlsx template (see Download Template)")

    raw = await file.read()
    try:
        workbook = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read this file as Excel (.xlsx) — please use the Download Template file")

    worksheet = _select_ekyc_bulk_data_worksheet(workbook)
    rows_iter = worksheet.iter_rows(values_only=True)
    fieldnames = [_ekyc_bulk_cell_str(h) for h in next(rows_iter, ())]
    header_map = _map_ekyc_bulk_headers(fieldnames)
    missing = [f for f in ("customer_name", "customer_mobile", "account_number", "doc_type") if f not in header_map]
    if missing:
        # User-facing labels only — never the internal snake_case field name
        # (e.g. "Customer Email", never "customer_email") — and each names a
        # couple of accepted header spellings so the admin doesn't have to
        # guess or rename their columns to match our internal names exactly.
        lines = [
            f'Missing required column: {_EKYC_BULK_REQUIRED_FIELD_LABELS[f]} '
            f'(accepted headers include "{_EKYC_BULK_REQUIRED_FIELD_LABELS[f]}", "{f}", "{_EKYC_BULK_REQUIRED_FIELD_LABELS[f].upper()}")'
            for f in missing
        ]
        raise HTTPException(status_code=400, detail=" ".join(lines))

    valid_rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    skipped_duplicates: list[dict[str, Any]] = []
    # Two independent dedupe keys — a duplicate on EITHER mobile or account
    # number is rejected, not just an exact match on both. Previously only
    # mobile was checked, so two rows with the same Account Number but
    # different mobiles were both silently imported.
    seen_mobiles_in_file: set[str] = set()
    seen_account_numbers_in_file: set[str] = set()

    # Row validation is read-only (no writes yet), so it doesn't need
    # get_transaction — only the dedupe-against-already-imported-rows check
    # below touches the DB, and only to read.
    with get_connection() as connection:
        for row_number, row_values in enumerate(rows_iter, start=2):  # row 1 is the header
            row = dict(zip(fieldnames, row_values))
            if not any(v is not None and str(v).strip() for v in row_values):
                continue  # blank template row (e.g. under the dropdown's pre-applied range) — silently skipped, not an error

            name = _ekyc_bulk_cell_str(row.get(header_map["customer_name"]))
            mobile = _ekyc_bulk_cell_str(row.get(header_map["customer_mobile"]))
            # Email isn't on the Download Template and is never required here
            # (see _EKYC_BULK_REQUIRED_FIELD_LABELS) — but if someone kept an
            # old template or hand-added the column, still read and validate
            # it rather than silently dropping a value they did provide.
            email = _ekyc_bulk_cell_str(row.get(header_map["customer_email"])) if "customer_email" in header_map else ""
            doc_type_raw = _ekyc_bulk_cell_str(row.get(header_map["doc_type"]))
            account_number = _ekyc_bulk_cell_str(row.get(header_map["account_number"]))

            row_errors: list[str] = []
            if not name:
                row_errors.append("Customer Name is required")
            if not mobile:
                row_errors.append("Mobile number is required")
            else:
                try:
                    validate_mobile(mobile)
                except ValueError as e:
                    row_errors.append(str(e))
            if not account_number:
                row_errors.append("Account Number is required")
            if email:
                try:
                    email = str(_ekyc_bulk_email_adapter.validate_python(email))
                except Exception:
                    row_errors.append("Email is invalid")
            doc_type = None
            if not doc_type_raw:
                row_errors.append("Document Type is required")
            else:
                try:
                    doc_type = _normalize_ekyc_bulk_doc_type(doc_type_raw)
                except ValueError as e:
                    row_errors.append(str(e))

            if row_errors:
                errors.append({"row": row_number, "message": "; ".join(row_errors)})
                continue

            if mobile in seen_mobiles_in_file:
                skipped_duplicates.append({"row": row_number, "message": "Duplicate Mobile of another row in this file"})
                continue
            if account_number in seen_account_numbers_in_file:
                skipped_duplicates.append({"row": row_number, "message": "Duplicate Account Number of another row in this file"})
                continue
            existing = connection.execute(
                """
                SELECT id FROM b2b_ekyc_bulk_record
                WHERE organization_id = %s AND order_id IS NULL
                  AND (customer_mobile = %s OR account_number = %s)
                LIMIT 1
                """,
                (organization_id, mobile, account_number),
            ).fetchone()
            if existing:
                skipped_duplicates.append({"row": row_number, "message": "Already imported and not yet initiated (same Mobile or Account Number)"})
                continue

            seen_mobiles_in_file.add(mobile)
            seen_account_numbers_in_file.add(account_number)
            valid_rows.append({
                "customer_name": name, "customer_mobile": mobile, "customer_email": email or None,
                "doc_type": doc_type, "account_number": account_number[:50] or None,
            })

    total_rows = len(valid_rows) + len(errors) + len(skipped_duplicates)
    if not valid_rows:
        return {"batch_id": None, "total_rows": total_rows, "imported_rows": 0, "skipped_duplicates": skipped_duplicates, "errors": errors}

    with get_transaction() as connection:
        batch = connection.execute(
            """
            INSERT INTO b2b_ekyc_bulk_batch (organization_id, organization_user_id, filename, total_rows, imported_rows, skipped_rows)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id, organization_user_id, file.filename, total_rows,
                len(valid_rows), len(errors) + len(skipped_duplicates),
            ),
        ).fetchone()
        for r in valid_rows:
            connection.execute(
                """
                INSERT INTO b2b_ekyc_bulk_record
                    (batch_id, organization_id, organization_user_id, customer_name, customer_email, customer_mobile, doc_type, account_number)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    batch["id"], organization_id, organization_user_id, r["customer_name"], r["customer_email"],
                    r["customer_mobile"], r["doc_type"], r["account_number"],
                ),
            )

    return {
        "batch_id": batch["id"], "total_rows": total_rows, "imported_rows": len(valid_rows),
        "skipped_duplicates": skipped_duplicates, "errors": errors,
    }


def list_ekyc_bulk_batches(*, organization_id: UUID, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    """One row per Excel upload (see _import_ekyc_bulk_excel) — "Import
    History" on the Bulk eKYC page, and also how that page finds its own
    "current" batch (the frontend just takes page=1/page_size=1's single
    result rather than trusting any client-side memory of the last upload).
    Each batch is enriched with a live per-status breakdown of its OWN
    records, using the exact same derivation list_ekyc_bulk_records's CASE
    expression uses — so "X of Y completed" here can never disagree with
    what the records themselves show once you open one."""
    page = max(page, 1)
    page_size = max(1, min(page_size, 100))

    with get_connection() as connection:
        rows = connection.execute(
            """
            WITH scored AS (
                SELECT
                    r.batch_id,
                    CASE
                        WHEN r.order_id IS NULL THEN 'Not Initiated'
                        WHEN o.status IN ('Verified', 'Document Extracted') THEN 'Completed'
                        WHEN o.status = 'Failed' THEN 'Failed'
                        ELSE 'In Progress'
                    END AS status
                FROM b2b_ekyc_bulk_record r
                LEFT JOIN orders o ON o.id = r.order_id
                WHERE r.organization_id = %s
            )
            SELECT
                b.id, b.filename, b.total_rows, b.imported_rows, b.skipped_rows, b.created_at,
                COUNT(s.batch_id) FILTER (WHERE s.status = 'Not Initiated') AS not_initiated_count,
                COUNT(s.batch_id) FILTER (WHERE s.status = 'In Progress') AS in_progress_count,
                COUNT(s.batch_id) FILTER (WHERE s.status = 'Completed') AS completed_count,
                COUNT(s.batch_id) FILTER (WHERE s.status = 'Failed') AS failed_count,
                COUNT(*) OVER() AS total_count
            FROM b2b_ekyc_bulk_batch b
            LEFT JOIN scored s ON s.batch_id = b.id
            WHERE b.organization_id = %s
            GROUP BY b.id, b.filename, b.total_rows, b.imported_rows, b.skipped_rows, b.created_at
            ORDER BY b.created_at DESC, b.id
            LIMIT %s OFFSET %s
            """,
            (organization_id, organization_id, page_size, (page - 1) * page_size),
        ).fetchall()

    total = rows[0]["total_count"] if rows else 0
    for r in rows:
        r.pop("total_count", None)
    return {"batches": rows, "total": total, "page": page, "page_size": page_size}


def list_ekyc_bulk_records(
    *, organization_id: UUID, search: str | None = None, status: str = "All",
    batch_id: UUID | None = None, page: int = 1, page_size: int = 20,
) -> dict[str, Any]:
    if status not in _EKYC_BULK_STATUS_VALUES:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(_EKYC_BULK_STATUS_VALUES)}")
    page = max(page, 1)
    page_size = max(1, min(page_size, 200))

    conditions = ["r.organization_id = %s"]
    params: list[Any] = [organization_id]
    if batch_id is not None:
        conditions.append("r.batch_id = %s")
        params.append(batch_id)
    if search:
        conditions.append("(r.customer_name ILIKE %s OR r.customer_mobile ILIKE %s OR r.customer_email ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like, like])
    where_clause = " AND ".join(conditions)

    with get_connection() as connection:
        rows = connection.execute(
            f"""
            WITH scored AS (
                SELECT
                    r.id, r.customer_name, r.customer_mobile, r.customer_email, r.doc_type, r.account_number,
                    r.order_id, o.order_no, r.created_at,
                    CASE
                        WHEN r.order_id IS NULL THEN 'Not Initiated'
                        WHEN o.status IN ('Verified', 'Document Extracted') THEN 'Completed'
                        WHEN o.status = 'Failed' THEN 'Failed'
                        ELSE 'In Progress'
                    END AS status
                FROM b2b_ekyc_bulk_record r
                LEFT JOIN orders o ON o.id = r.order_id
                WHERE {where_clause}
            )
            SELECT *, COUNT(*) OVER() AS total_count
            FROM scored
            WHERE (%s = 'All' OR status = %s)
            ORDER BY created_at DESC, id
            LIMIT %s OFFSET %s
            """,
            (*params, status, status, page_size, (page - 1) * page_size),
        ).fetchall()

    total = rows[0]["total_count"] if rows else 0
    for r in rows:
        r.pop("total_count", None)
    return {"records": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/ekyc-bulk/template")
def download_partner_ekyc_bulk_template(
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> StreamingResponse:
    content = _build_ekyc_bulk_template()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ekyc_bulk_template.xlsx"'},
    )


@router.post("/ekyc-bulk/import", status_code=201)
async def import_partner_ekyc_bulk_excel(
    file: UploadFile = File(...),
    organization_user_id: UUID | None = Form(None),
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    # organization_user_id is optional here — same "Created For" pattern as
    # /orders above — a Partner can attribute a whole import to one of their
    # users, or leave it org-wide (None), unlike a Partner User's own import
    # (partner_user.import_ekyc_bulk_excel), which is always their own membership.
    return await _import_ekyc_bulk_excel(
        file=file, organization_id=current_partner["organization_id"], organization_user_id=organization_user_id,
    )


@router.get("/ekyc-bulk/batches")
def list_partner_ekyc_bulk_batches(
    page: int = 1,
    page_size: int = 20,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return list_ekyc_bulk_batches(organization_id=current_partner["organization_id"], page=page, page_size=page_size)


@router.get("/ekyc-bulk/records")
def list_partner_ekyc_bulk_records(
    search: str | None = None,
    status: str = "All",
    batch_id: UUID | None = None,
    page: int = 1,
    page_size: int = 20,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    return list_ekyc_bulk_records(
        organization_id=current_partner["organization_id"], search=search, status=status,
        batch_id=batch_id, page=page, page_size=page_size,
    )


@router.post("/orders/{order_id}/submit")
def submit_partner_order(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]
    with get_transaction() as connection:
        order = connection.execute(
            "SELECT id, status FROM orders WHERE id = %s AND organization_id = %s",
            (order_id, organization_id),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["status"] != "Draft":
            raise HTTPException(status_code=400, detail="Only draft orders can be submitted")

        connection.execute(
            "UPDATE orders SET status = 'Submitted', updated_at = now() WHERE id = %s",
            (order_id,),
        )
    return get_partner_order(order_id, current_partner)


@router.post("/orders/{order_id}/cancel")
def cancel_partner_order(
    order_id: UUID,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> dict[str, Any]:
    organization_id = current_partner["organization_id"]
    with get_transaction() as connection:
        order = connection.execute(
            "SELECT id, status FROM orders WHERE id = %s AND organization_id = %s",
            (order_id, organization_id),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if order["status"] not in ("Draft", "Submitted"):
            raise HTTPException(status_code=400, detail="Only draft or submitted orders can be cancelled")

        connection.execute(
            "UPDATE orders SET status = 'Cancelled', updated_at = now() WHERE id = %s",
            (order_id,),
        )
    return get_partner_order(order_id, current_partner)


# =========================================
# REPORTS
# =========================================


@router.get("/reports/sbtr-challans")
def list_partner_sbtr_challan_reports(
    date_from: date | None = None,
    date_to: date | None = None,
    current_partner: dict[str, Any] = Depends(get_current_partner),
) -> list[dict[str, Any]]:
    # organization_id is forced to the logged-in partner's own org — never
    # client-supplied — so a partner can only ever see their own records.
    return get_sbtr_challan_reports(current_partner["organization_id"], date_from, date_to)
