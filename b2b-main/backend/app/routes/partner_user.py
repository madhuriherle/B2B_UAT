import io
import json
from datetime import date
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, ValidationError, field_validator, model_validator

from app.auth import get_current_partner_user
from app.database import get_connection, get_transaction
from app.digilocker_service import fetch_aadhaar_details, get_digilocker_status, initiate_digilocker
from app.ekyc_service import get_ekyc_status, initiate_ekyc
from app.pan_service import get_pan_status, initiate_pan_verification
from app.esign_service import (
    SignerIn,
    cancel_esign_workflow,
    get_esign_status,
    get_signed_file_path,
    initiate_esign,
    resend_signer_invitation,
)
from app.invoice_service import (
    _invoice_belongs_to_user,
    download_invoice_pdf,
    download_invoice_pdf_for_order,
    list_invoices_for_user,
)
from app.routes.accounts import get_invoice
from app.organization_state import (
    STATE_NAME_TO_SIGNDESK_STAMP_CODE,
    get_organization_state,
)
from app.routes.document_service import list_configured_documents_summary
from app.routes.article_codes import get_active_article_codes
from app.routes.organizations import (
    get_organization_charge_pricing,
    get_organization_service_charge_pricing,
    list_bulk_estamp_pricing_rules,
)
from app.routes.partner import (
    _build_ekyc_bulk_template,
    _create_order,
    _import_ekyc_bulk_excel,
    _order_upload_dir,
    _pdf_inline_response,
    create_bulk_estamp_order,
    create_manual_estamp_order,
    get_manual_estamp_stamped_file_path,
    get_partner_order_with_esign,
    list_ekyc_bulk_batches,
    list_ekyc_bulk_records,
    list_partner_orders,
    list_partner_services,
    list_partner_user_services,
)
from app.routes.reports import get_sbtr_challan_reports
from app.stamp_service import (
    StampInitiateRequest,
    StampOtfInitiateRequest,
    get_stamp_otf_file_path,
    get_stamp_otf_status,
    get_stamp_status,
    get_stamped_file_path,
    initiate_stamp,
    initiate_stamp_otf,
)

router = APIRouter()


class EsignInitiateRequest(BaseModel):
    signers: list[SignerIn]


class EkycVerifyRequest(BaseModel):
    verification: bool = True


class BulkEstampItemIn(BaseModel):
    # Either an existing Super-Admin-configured denomination, or a custom
    # amount typed directly (no pre-configuration required — see
    # partner.create_bulk_estamp_order, which finds-or-creates the master
    # row for it). Exactly one of the two must be given.
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
    # Which position (First/Second Party) the logged-in Partner occupies on
    # the stamp — the Partner's own name/address for that position is always
    # derived server-side from the authenticated organization (see
    # partner.create_bulk_estamp_order), never accepted from the client. Only
    # the OTHER, different party's details are ever client-supplied here, and
    # who's responsible for paying is independent of which position the
    # Partner holds (see PartnerUserCreateEstampBulk.jsx).
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
    # Picked per order on the create-order form now (see
    # PartnerUserCreateEstampBulk.jsx), not resolved from the organization's
    # onboarding state. Optional — eStamp Bulk orders don't require a named
    # customer.
    customer_name: str | None = None
    customer_email: EmailStr | None = None
    customer_mobile: str | None = None
    stamp_state_id: UUID
    # Exactly one of (items) or (consideration_amount + article_code_id) is
    # actually used, decided server-side by the selected state's Super
    # Admin-configured stamp paper type — never trusted from the client (see
    # partner.create_bulk_estamp_order). items defaults to [] since an
    # eStamp-type state's request carries none at all — the Partner never
    # selects a denomination for those; Admin adds it later.
    items: list[BulkEstampItemIn] = []
    consideration_amount: float | None = None
    article_code_id: UUID | None = None
    delivery_address: BulkEstampDeliveryAddressIn
    party_details: BulkEstampPartyDetailsIn


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

# =========================================
# PARTNER USER PORTAL (Cyber Shops / associates)
#
# The third tier below Super Admin -> Partner -> Partner User. Every route
# here reuses the exact same query/business logic as the Partner-level
# equivalent in partner.py — nothing is duplicated — but is scoped through
# get_current_partner_user, which resolves organization_id AND
# organization_user_id from the authenticated token. Neither id is ever
# accepted from the client.
# =========================================


@router.get("/profile")
def get_partner_user_profile(current_partner_user: dict[str, Any] = Depends(get_current_partner_user)) -> dict[str, Any]:
    # Local import — see get_order_report_detail's own local import in
    # reports.py for why (app.routes.partner <-> app.invoice_service <->
    # this module).
    from app.invoice_service import _is_karnataka, _tax_split

    with get_connection() as connection:
        wallet = connection.execute(
            "SELECT COALESCE(balance, 0) AS balance, COALESCE(blocked_amount, 0) AS blocked_amount "
            "FROM organization_user_wallet WHERE organization_user_id = %s",
            (current_partner_user["organization_user_id"],),
        ).fetchone()
        # Registered-address fields captured at onboarding (see
        # CustomerOnboard.jsx) — used to prefill "Same as registered address"
        # on the eStamp Bulk delivery form.
        org = connection.execute(
            "SELECT address_line1, address_line2, city, pincode, contact_person, mobile FROM organizations WHERE id = %s",
            (current_partner_user["organization_id"],),
        ).fetchone()

    # The eStamp/eStamp Bulk/Manual eStamp create-order forms each collect
    # their own state per order (see organization_state.resolve_stamp_state_code)
    # rather than being hard-locked to this onboarding value — eStamp Bulk
    # uses it only to default the Stamp State field, still overridable. A
    # missing state here just shows up as null rather than a hard error.
    state = get_organization_state(current_partner_user["organization_id"])

    # Same rate the eventual Service Invoice will actually apply to this
    # order's service/delivery/documentation charges (see
    # invoice_service._resolve_order_invoice's bulk branch / _tax_split) —
    # exposed here, rather than re-guessed client-side, purely so the eStamp
    # Bulk create-order preview can show it ahead of time without risking
    # disagreement with the real invoice. Never applies to the stamp face
    # value itself (_stamp_item is always 0% GST).
    cgst, sgst, igst = _tax_split(_is_karnataka(state["state_name"] if state else None))
    service_charge_gst_rate = cgst + sgst + igst

    return {
        "organization_user_id": current_partner_user["organization_user_id"],
        "organization_id": current_partner_user["organization_id"],
        "organization_name": current_partner_user["organization_name"],
        "full_name": current_partner_user["full_name"],
        "email": current_partner_user["email"],
        "wallet_balance": wallet["balance"] if wallet else 0,
        "wallet_blocked_amount": wallet["blocked_amount"] if wallet else 0,
        "wallet_available_balance": (float(wallet["balance"]) - float(wallet["blocked_amount"])) if wallet else 0,
        "state_id": state["state_id"] if state else None,
        "state_name": state["state_name"] if state else None,
        "stamp_state_code": (STATE_NAME_TO_SIGNDESK_STAMP_CODE.get(state["state_name"]) if state else None),
        "registered_address_line1": org["address_line1"] if org else None,
        "registered_address_line2": org["address_line2"] if org else None,
        "registered_city": org["city"] if org else None,
        "registered_pincode": org["pincode"] if org else None,
        "contact_person": org["contact_person"] if org else None,
        "org_mobile": org["mobile"] if org else None,
        "service_charge_gst_rate": service_charge_gst_rate,
    }


@router.get("/wallet")
def get_my_wallet(current_partner_user: dict[str, Any] = Depends(get_current_partner_user)) -> dict[str, Any]:
    organization_user_id = current_partner_user["organization_user_id"]
    with get_connection() as connection:
        wallet = connection.execute(
            "SELECT balance, blocked_amount, updated_at FROM organization_user_wallet WHERE organization_user_id = %s",
            (organization_user_id,),
        ).fetchone()
        if not wallet:
            wallet = {"balance": 0, "blocked_amount": 0, "updated_at": None}

        transactions = connection.execute(
            """
            SELECT id, type, amount, balance_after, description, created_at
            FROM organization_user_wallet_transactions
            WHERE organization_user_id = %s
            ORDER BY created_at DESC
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

    # available_balance = balance - blocked_amount is what a new order is
    # actually checked against (see partner._block_wallet_amount) — surfaced
    # here so the Wallet page can show it distinctly from the raw balance.
    available_balance = float(wallet["balance"] or 0) - float(wallet["blocked_amount"] or 0)
    return {**wallet, **totals, "available_balance": available_balance, "transactions": transactions}


@router.get("/invoices")
def list_my_invoices(current_partner_user: dict[str, Any] = Depends(get_current_partner_user)) -> list[dict[str, Any]]:
    return list_invoices_for_user(
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
    )


@router.get("/invoices/{invoice_id}")
def get_my_invoice(
    invoice_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    """Full invoice detail (line items + totals) for the User Portal's
    Invoices page "View" popup — same ownership check download_my_invoice
    already uses, just returning JSON instead of a PDF."""
    invoice = get_invoice(invoice_id)
    if not _invoice_belongs_to_user(
        invoice, organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
    ):
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.get("/invoices/{invoice_id}/pdf")
def download_my_invoice(
    invoice_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> StreamingResponse:
    return download_invoice_pdf(
        invoice_id=invoice_id,
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
    )


@router.get("/services")
def list_my_services(current_partner_user: dict[str, Any] = Depends(get_current_partner_user)) -> dict[str, Any]:
    organization_id = current_partner_user["organization_id"]

    # Retailer-type orgs have no upstream Partner to assign individual
    # services to their one member login — that login IS the organization,
    # so it sees every service/document Super Admin activated for the org
    # directly, the same way a Partner sees their own org's services.
    # Dealer-type orgs keep the assignment-gated view: their members are
    # separate Cyber Shop accounts the Partner explicitly grants access to.
    if current_partner_user["organization_type"] == "Retailer":
        services = [
            {"service_pricing_id": None, "service_name": s["service_name"], "price": s["price"], "assigned": True}
            for s in list_partner_services(current_partner={"organization_id": organization_id})
            if s["is_active"] and s["service_name"] != "Document Service"
        ]
        documents = [
            {
                "document_config_id": d["config_id"],
                "doc_name": d["doc_name"],
                "state_id": d["state_id"],
                "state_name": d["state_name"],
                "base_price": d["base_price"],
                "assigned": True,
            }
            for d in list_configured_documents_summary(organization_id)
        ]
        return {"services": services, "documents": documents}

    return list_partner_user_services(
        membership_id=current_partner_user["organization_user_id"],
        current_partner={"organization_id": organization_id},
    )


@router.get("/charges")
def list_my_charges(current_partner_user: dict[str, Any] = Depends(get_current_partner_user)) -> dict[str, Any]:
    # Charges (Delivery Charge, Documentation Charge, Service Charge, ...)
    # have no Dealer/Retailer assignment table the way services do — every
    # member of the org sees whatever Super Admin has enabled for the org as
    # a whole. Only enabled charges are returned; a member has no reason to
    # know about ones Super Admin configured but left off.
    pricing = get_organization_charge_pricing(current_partner_user["organization_id"])
    return {
        "charges": [
            {"charge_name": c["charge_name"], "price": c["price"]}
            for c in pricing["charges"]
            if c["is_active"]
        ]
    }


@router.get("/services/{service_name}/charges")
def list_my_service_charges(
    service_name: str, current_partner_user: dict[str, Any] = Depends(get_current_partner_user)
) -> dict[str, Any]:
    # The additional, admin-defined charges Super Admin assigned to THIS
    # service for this org (organization_service_charge_pricing) — distinct
    # from the org-wide /charges above. Read-only: a Partner/User can preview
    # what an order will cost, never configure it (that's admin-only, see
    # organizations.update_organization_service_charge_pricing). Only active
    # assignments are returned, same reasoning as /charges above.
    pricing = get_organization_service_charge_pricing(current_partner_user["organization_id"])
    return {
        "charges": [
            {
                "charge_name": c["charge_name"],
                "price": c["price"],
                # Exposed only so the order-create form can preview a
                # percentage-based charge (e.g. "Service Charge") before
                # submitting — the actual amount charged is always
                # recalculated authoritatively server-side at order creation,
                # never trusted from this preview.
                "calculation_type": c["calculation_type"],
                "percentage": c["percentage"],
                "minimum_amount": c["minimum_amount"],
            }
            for c in pricing["charges"]
            if c["service_name"] == service_name and c["is_active"]
        ]
    }


@router.get("/estamp-bulk-pricing-rules")
def list_my_bulk_estamp_pricing_rules(
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> list[dict[str, Any]]:
    # Read-only preview so the Create eStamp Bulk Order form's Order Summary
    # can show the same "Bulk eStamp Pricing" figure the order will actually
    # be charged (see partner._match_bulk_estamp_pricing_rule) — a Partner
    # never sees or edits the ranges themselves (that's admin-only, see
    # organizations.py's estamp-bulk-pricing-rules endpoints), only the
    # resulting charge for the denomination/quantity they picked. Only active
    # rules are returned; a disabled rule can never match an order anyway.
    rules = list_bulk_estamp_pricing_rules(current_partner_user["organization_id"])
    return [r for r in rules if r["is_active"]]


@router.get("/article-codes")
def list_my_article_codes(
    state_id: UUID | None = None,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> list[dict[str, Any]]:
    # Read-only — populates the Article Code dropdown on the Create eStamp
    # Bulk Order form for eStamp-type states (see article_codes.py; never
    # hardcoded). Same "active only" reasoning as every other master-data
    # preview endpoint in this file. Scoped to the selected Stamp State —
    # Article Codes are configured per-state, so another state's codes must
    # never show up here (see PartnerUserCreateEstampBulk.jsx).
    return get_active_article_codes(state_id)


@router.get("/orders")
def list_my_orders(
    status: str | None = None,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> list[dict[str, Any]]:
    return list_partner_orders(
        status=status,
        organization_user_id=current_partner_user["organization_user_id"],
        current_partner={"organization_id": current_partner_user["organization_id"]},
    )


@router.get("/orders/{order_id}")
def get_my_order(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    order = get_partner_order_with_esign(
        order_id=order_id,
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
    )
    # Explicit original_pdf/signed_pdf/workflow_status contract for the Order
    # Detail view — these are portal-relative preview URLs (auth'd via the
    # Bearer token, same as everything else in this app), not raw disk paths.
    # signed_pdf is only set when a signed PDF has actually been stored for
    # the latest active workflow (see esign.signed_file_path); otherwise the
    # frontend falls back to original_pdf, per the versioning-aware lookup
    # already built into get_signed_file_path/preview endpoints below.
    esign = order.get("esign")
    order["original_pdf"] = f"/api/partner-user/orders/{order_id}/document/preview" if order.get("document_path") else None
    order["signed_pdf"] = (
        f"/api/partner-user/orders/{order_id}/document/signed-preview"
        if esign and esign.get("signed_file_path")
        else None
    )
    order["workflow_status"] = esign["status_label"] if esign and esign.get("status_label") else order["status"]

    # eKYC's General Document Verification result and/or DigiLocker/PAN
    # verification, if any were ever submitted for this order. The Order
    # Detail page is the durable, refresh-safe view of all three.
    order["ekyc"] = None
    order["digilocker"] = None
    order["pan"] = None
    if order["service_name"] == "eKYC":
        try:
            order["ekyc"] = get_ekyc_status(
                order_id=order_id, organization_id=current_partner_user["organization_id"],
            )
        except HTTPException:
            pass
        try:
            order["digilocker"] = get_digilocker_status(
                order_id=order_id, organization_id=current_partner_user["organization_id"],
            )
        except HTTPException:
            pass
        if order["document_type"] == "pan_card":
            try:
                order["pan"] = get_pan_status(
                    order_id=order_id, organization_id=current_partner_user["organization_id"],
                )
            except HTTPException:
                pass

    # Local import — see get_partner_user_profile's own local import above
    # for why (app.routes.partner <-> app.invoice_service <-> this module).
    from app.invoice_service import get_order_pricing_preview

    order["pricing_preview"] = get_order_pricing_preview(
        organization_id=current_partner_user["organization_id"], order=order,
    )

    return order


@router.get("/orders/{order_id}/invoice/pdf")
def download_my_order_invoice(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> StreamingResponse:
    # Reimbursement (stamp duty orders) vs Normal Invoice is decided
    # automatically from the order's own data — see invoice_service. Generated
    # once per order and frozen from then on (idempotent under duplicate
    # clicks/requests), never regenerated even if pricing config changes later.
    return download_invoice_pdf_for_order(
        order_id=order_id,
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
    )


@router.get("/orders/{order_id}/document")
def download_my_order_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    with get_connection() as connection:
        order = connection.execute(
            "SELECT document_path, document_filename FROM orders WHERE id = %s AND organization_id = %s AND organization_user_id = %s",
            (order_id, current_partner_user["organization_id"], current_partner_user["organization_user_id"]),
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
def preview_my_order_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    """Same file as download_my_order_document, but served inline
    (application/pdf, no attachment disposition) for the Order Detail page's
    left-panel PDF viewer."""
    with get_connection() as connection:
        order = connection.execute(
            "SELECT document_path FROM orders WHERE id = %s AND organization_id = %s AND organization_user_id = %s",
            (order_id, current_partner_user["organization_id"], current_partner_user["organization_user_id"]),
        ).fetchone()
    if not order or not order["document_path"]:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = _order_upload_dir() / order["document_path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Document file is missing on the server")

    return _pdf_inline_response(file_path)


@router.get("/orders/{order_id}/document/signed-preview")
def preview_my_order_signed_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    """The latest signed-PDF snapshot (may only have some signatures applied
    so far — see esign_service.record_callback), served inline for the Order
    Detail page's left-panel PDF viewer."""
    path = get_signed_file_path(order_id=order_id, organization_id=current_partner_user["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


@router.post("/orders", status_code=201)
async def create_my_order(
    service_name: str = Form(...),
    customer_name: str = Form(...),
    customer_email: EmailStr | None = Form(None),
    customer_mobile: str = Form(...),
    action: str = Form("submit"),
    document: UploadFile = File(...),
    quantity: int = Form(1),
    doc_type: str | None = Form(None),
    bulk_ekyc_record_id: UUID | None = Form(None),
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    # organization_user_id is always the caller's own membership — a Partner
    # User can only ever create orders for themselves, never on behalf of
    # another user in the org. Assignment is only enforced for Dealer-type
    # orgs (Cyber Shop accounts); a Retailer's member IS the organization, so
    # it may use any service Super Admin activated for the org — see
    # list_my_services above.
    return await _create_order(
        service_name=service_name,
        customer_name=customer_name,
        customer_email=customer_email,
        customer_mobile=customer_mobile,
        action=action,
        document=document,
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
        enforce_user_assignment=current_partner_user["organization_type"] != "Retailer",
        quantity=quantity,
        document_type=doc_type,
        bulk_ekyc_record_id=bulk_ekyc_record_id,
    )


@router.get("/stamp-denominations")
def list_my_stamp_denominations(
    state_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> list[dict[str, Any]]:
    # Read-only — the real B2B stamp denomination master (b2b_stamp_denomination)
    # is otherwise admin-only (/api/stamps); eStamp Bulk and Manual eStamp both
    # use this member-facing equivalent to build their denomination pickers
    # from real, per-state values instead of a hardcoded list. The state is
    # now picked per-order on the create-order form (see
    # PartnerUserCreateEstampBulk.jsx / PartnerUserCreateManualEstamp.jsx),
    # not resolved from the organization's onboarding config.
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


@router.post("/orders/estamp-bulk", status_code=201)
def create_my_bulk_estamp_order(
    payload: BulkEstampOrderCreate,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return create_bulk_estamp_order(
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
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


@router.post("/orders/manual-estamp", status_code=201)
async def create_my_manual_estamp_order(
    customer_name: str = Form(...),
    customer_email: EmailStr = Form(...),
    customer_mobile: str = Form(...),
    stamp_state_id: UUID = Form(...),
    stamp_amount: float = Form(...),
    esign_required: bool = Form(False),
    # JSON-encoded — this endpoint is multipart/form-data (it also carries the
    # document file), and Form fields are flat, so the nested signer list /
    # delivery address travel as JSON strings rather than real nested fields.
    esign_signers: str = Form("[]"),
    delivery_address: str | None = Form(None),
    document: UploadFile = File(...),
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
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
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
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


@router.get("/reports/sbtr-challans")
def list_my_sbtr_challan_reports(
    date_from: date | None = None,
    date_to: date | None = None,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> list[dict[str, Any]]:
    return get_sbtr_challan_reports(current_partner_user["organization_id"], date_from, date_to)


@router.post("/orders/{order_id}/esign/initiate", status_code=201)
def initiate_my_order_esign(
    order_id: UUID,
    body: EsignInitiateRequest,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return initiate_esign(
        order_id=order_id,
        organization_id=current_partner_user["organization_id"],
        signers=body.signers,
    )


@router.get("/orders/{order_id}/esign/status")
def get_my_order_esign_status(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return get_esign_status(order_id=order_id, organization_id=current_partner_user["organization_id"])


@router.get("/orders/{order_id}/esign/download")
def download_my_order_signed_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    path = get_signed_file_path(order_id=order_id, organization_id=current_partner_user["organization_id"])
    return FileResponse(path, filename=f"{order_id}-signed.pdf", media_type="application/pdf")


@router.post("/orders/{order_id}/esign/cancel")
def cancel_my_order_esign(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return cancel_esign_workflow(order_id=order_id, organization_id=current_partner_user["organization_id"])


@router.post("/orders/{order_id}/esign/signers/{signer_id}/resend")
def resend_my_order_signer_invite(
    order_id: UUID,
    signer_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return resend_signer_invitation(order_id=order_id, signer_id=signer_id, organization_id=current_partner_user["organization_id"])


@router.post("/orders/{order_id}/stamp/initiate", status_code=201)
def initiate_my_order_stamp(
    order_id: UUID,
    body: StampInitiateRequest,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return initiate_stamp(order_id=order_id, organization_id=current_partner_user["organization_id"], body=body)


@router.get("/orders/{order_id}/stamp/status")
def get_my_order_stamp_status(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return get_stamp_status(order_id=order_id, organization_id=current_partner_user["organization_id"])


@router.get("/orders/{order_id}/document/stamped-preview")
def preview_my_order_stamped_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    path = get_stamped_file_path(order_id=order_id, organization_id=current_partner_user["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


# "eStamp On The Fly" (Karnataka) — distinct path segment (stamp-otf, not
# stamp) so these can never collide with the plain-eStamp trio above, which
# is hardwired to service_name == "eStamp" (see stamp_service._get_order_for_stamp).
@router.post("/orders/{order_id}/stamp-otf/initiate", status_code=201)
def initiate_my_order_stamp_otf(
    order_id: UUID,
    body: StampOtfInitiateRequest,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return initiate_stamp_otf(order_id=order_id, organization_id=current_partner_user["organization_id"], body=body)


@router.get("/orders/{order_id}/stamp-otf/status")
def get_my_order_stamp_otf_status(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return get_stamp_otf_status(order_id=order_id, organization_id=current_partner_user["organization_id"])


@router.get("/orders/{order_id}/document/stamp-otf-preview")
def preview_my_order_stamp_otf_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    path = get_stamp_otf_file_path(order_id=order_id, organization_id=current_partner_user["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


@router.get("/orders/{order_id}/document/manual-stamped-preview")
def preview_my_manual_estamp_stamped_document(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> FileResponse:
    path = get_manual_estamp_stamped_file_path(order_id=order_id, organization_id=current_partner_user["organization_id"])
    return _pdf_inline_response(path, require_safe_content=False)


@router.post("/orders/{order_id}/ekyc/verify", status_code=201)
def verify_my_order_ekyc(
    order_id: UUID,
    body: EkycVerifyRequest,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return initiate_ekyc(
        order_id=order_id,
        organization_id=current_partner_user["organization_id"],
        verification=body.verification,
    )


@router.get("/orders/{order_id}/ekyc/status")
def get_my_order_ekyc_status(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return get_ekyc_status(order_id=order_id, organization_id=current_partner_user["organization_id"])


# =========================================
# BULK EKYC (.xlsx import) — the actual parsing/validation/template-building
# logic, plus the batches/records listing queries, now live in
# app.routes.partner (shared with the Partner Portal's identical screen) —
# see that module's own "BULK EKYC" section for the full explanation. These
# are thin wrappers supplying this member's own organization_id/
# organization_user_id.
# =========================================


@router.get("/ekyc-bulk/template")
def download_ekyc_bulk_template(
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> StreamingResponse:
    content = _build_ekyc_bulk_template()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ekyc_bulk_template.xlsx"'},
    )


@router.post("/ekyc-bulk/import", status_code=201)
async def import_ekyc_bulk_excel(
    file: UploadFile = File(...),
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return await _import_ekyc_bulk_excel(
        file=file,
        organization_id=current_partner_user["organization_id"],
        organization_user_id=current_partner_user["organization_user_id"],
    )


@router.get("/ekyc-bulk/batches")
def list_my_ekyc_bulk_batches(
    page: int = 1,
    page_size: int = 20,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return list_ekyc_bulk_batches(organization_id=current_partner_user["organization_id"], page=page, page_size=page_size)


@router.get("/ekyc-bulk/records")
def list_my_ekyc_bulk_records(
    search: str | None = None,
    status: str = "All",
    batch_id: UUID | None = None,
    page: int = 1,
    page_size: int = 20,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return list_ekyc_bulk_records(
        organization_id=current_partner_user["organization_id"], search=search, status=status,
        batch_id=batch_id, page=page, page_size=page_size,
    )



@router.post("/orders/{order_id}/digilocker/verify", status_code=201)
def verify_my_order_digilocker(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return initiate_digilocker(
        order_id=order_id,
        organization_id=current_partner_user["organization_id"],
    )


@router.get("/orders/{order_id}/digilocker/status")
def get_my_order_digilocker_status(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return get_digilocker_status(order_id=order_id, organization_id=current_partner_user["organization_id"])


@router.post("/orders/{order_id}/digilocker/fetch-aadhaar")
def fetch_my_order_digilocker_aadhaar(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    """Call once the user has completed DigiLocker auth via the link from
    /digilocker/verify — fetches and stores the Aadhaar details (see
    digilocker_service.fetch_aadhaar_details for what is/isn't persisted)."""
    return fetch_aadhaar_details(order_id=order_id, organization_id=current_partner_user["organization_id"])


@router.post("/orders/{order_id}/pan/verify", status_code=201)
def verify_my_order_pan(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    """PAN card orders only — cross-checks the already-uploaded document
    against government PAN records via SignDesk's dedicated PAN Verification
    API, on top of the General Document Verification extraction every eKYC
    order already gets."""
    return initiate_pan_verification(
        order_id=order_id,
        organization_id=current_partner_user["organization_id"],
    )


@router.get("/orders/{order_id}/pan/status")
def get_my_order_pan_status(
    order_id: UUID,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    return get_pan_status(order_id=order_id, organization_id=current_partner_user["organization_id"])
