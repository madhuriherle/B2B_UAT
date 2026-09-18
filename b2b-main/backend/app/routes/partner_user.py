import io
import json
from datetime import date
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator, model_validator

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
                "doc_id": d["doc_id"],
                "doc_name": d["doc_name"],
                "category_name": d["category_name"],
                "state_id": d["state_id"],
                "state_name": d["state_name"],
                "base_price": d["base_price"],
                "available_languages": d["available_languages"] or [],
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



# =========================================================================
# Loan Application — multi-party request shape. Every field the customer
# enters that belongs to a specific person (Applicant/Co-Applicant(s)/
# Guarantor(s)) lives on a PartyInput; everything else (loan-type-specific
# fields like vehicle/property/farm details) stays in the flat
# `dynamic_fields` dict, unchanged from before this was multi-party. See
# app/loan_i18n.py's FIELD_LABELS for the translated label of every key
# below, and LoanDocumentFlow.jsx for the matching frontend shape.
# =========================================================================

class PartyPersonal(BaseModel):
    full_name: str = ""
    gender: str = ""
    date_of_birth: str = ""
    marital_status: str = ""
    spouse_name: str = ""
    father_name: str = ""
    mother_maiden_name: str = ""
    category: str = ""
    religion: str = ""
    nationality: str = ""
    residential_status: str = ""
    no_of_dependents: str = ""
    occupation: str = ""
    pan_number: str = ""
    aadhaar_number: str = ""
    voter_id: str = ""
    driving_license: str = ""
    passport_number: str = ""
    passport_valid_upto: str = ""


class PartyAddressBlock(BaseModel):
    house_no: str = ""
    street: str = ""
    landmark: str = ""
    city: str = ""
    district: str = ""
    state: str = ""
    pincode: str = ""
    country: str = ""
    mobile: str = ""
    email: str = ""


class PartyAddress(BaseModel):
    present: PartyAddressBlock = Field(default_factory=PartyAddressBlock)
    # When true (the default), `permanent` is ignored and the PDF only
    # prints Present Address — mirrors the "Same as present address? Yes/No"
    # checkbox on every real bank form this was modeled on.
    permanent_same_as_present: bool = True
    permanent: PartyAddressBlock | None = None
    office: PartyAddressBlock | None = None


class PartyEmployment(BaseModel):
    occupation_type: str = ""
    employer_name: str = ""
    designation: str = ""
    department: str = ""
    employee_no: str = ""
    employment_status: str = ""
    organization_type: str = ""
    total_experience: str = ""
    years_present_job: str = ""
    business_name: str = ""
    business_type: str = ""
    monthly_income: str = ""


class IncomeRow(BaseModel):
    income_head: str = ""
    gross_income: str = ""
    net_income: str = ""
    frequency: str = ""


class ExistingLoanRow(BaseModel):
    loan_bank: str = ""
    loan_type: str = ""
    loan_emi: str = ""
    loan_tenure: str = ""
    loan_outstanding: str = ""


class BankAccountRow(BaseModel):
    bank_name: str = ""
    bank_branch: str = ""
    account_type: str = ""
    account_number: str = ""


class AssetRow(BaseModel):
    asset_type: str = ""
    asset_description: str = ""
    asset_value: str = ""


class ReferenceRow(BaseModel):
    reference_name: str = ""
    reference_address: str = ""
    reference_phone: str = ""


class PartyInput(BaseModel):
    role: Literal["applicant", "co_applicant", "guarantor"]
    personal: PartyPersonal = Field(default_factory=PartyPersonal)
    address: PartyAddress = Field(default_factory=PartyAddress)
    employment: PartyEmployment = Field(default_factory=PartyEmployment)
    income_sources: list[IncomeRow] = Field(default_factory=list)
    existing_loans: list[ExistingLoanRow] = Field(default_factory=list)
    bank_accounts: list[BankAccountRow] = Field(default_factory=list)
    assets: list[AssetRow] = Field(default_factory=list)
    references: list[ReferenceRow] = Field(default_factory=list)


class LoanDraftRequest(BaseModel):
    document_name: str
    language: str
    loan_amount: str
    tenure: str
    interest_rate: str = "12"
    repayment_frequency: str = "Monthly"
    dynamic_fields: dict = Field(default_factory=dict)
    parties: list[PartyInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def _require_one_applicant(self):
        applicants = [p for p in self.parties if p.role == "applicant"]
        if len(applicants) != 1:
            raise ValueError("Exactly one party with role 'applicant' is required")
        return self


def _add_months(d, months: int):
    """Calendar month-add with no external dependency — clamps the day to
    the target month's real length (e.g. Jan 31 + 1 month -> Feb 28/29)."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    days_in_month = [31, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    day = min(d.day, days_in_month[month - 1])
    return d.replace(year=year, month=month, day=day)


def _calc_emi(principal: str, annual_rate_pct: str, months: str) -> float | None:
    """Standard reducing-balance EMI formula. None on unparseable input
    (left blank in the document rather than guessing)."""
    try:
        p = float(principal)
        r = float(annual_rate_pct) / 12 / 100
        n = int(float(months))
    except (TypeError, ValueError):
        return None
    if p <= 0 or n <= 0:
        return None
    if r == 0:
        return round(p / n, 2)
    factor = (1 + r) ** n
    return round(p * r * factor / (factor - 1), 2)


def _mask_aadhaar(value: str) -> str:
    """Never print a full Aadhaar number — UIDAI masking convention (last 4
    digits only), same rule the eKYC result display already applies
    client-side (see lib/ekycFields.js)."""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) >= 4:
        return f"XXXX XXXX {digits[-4:]}"
    return str(value)


@router.post("/loans/generate_draft")
def generate_loan_draft(
    req: LoanDraftRequest,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
):
    import io
    import uuid
    from datetime import datetime
    from xml.sax.saxutils import escape as xml_escape
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from fastapi.responses import Response
    from app.loan_i18n import get_loan_fonts, get_loan_i18n, get_field_label, get_loan_type_config, get_application_no_prefix

    font_regular, font_bold = get_loan_fonts(req.language)
    t = get_loan_i18n(req.language)
    type_config = get_loan_type_config(req.document_name)

    # The vendored per-script Noto fonts (like Google Fonts' subsets
    # generally) only cover their own script plus digits/punctuation — no
    # Latin A-Z/a-z glyphs. Everything a partner user actually types
    # (customer name, VIN, vehicle make/model, Rs. prefix) is virtually
    # always Latin script regardless of the chosen document language, so it
    # must render in Helvetica explicitly rather than the translated font,
    # or it silently disappears. escape() guards against user input (a name
    # containing "<"/"&") breaking — or manipulating — this Paragraph markup.
    def latin(text, bold=False):
        face = "Helvetica-Bold" if bold else "Helvetica"
        return f'<font face="{face}">{xml_escape(str(text))}</font>'

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=48,
        leftMargin=48,
        topMargin=48,
        bottomMargin=48
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'TitleStyle', parent=styles['Heading1'], fontName=font_bold, fontSize=18, alignment=1, spaceAfter=24,
    )
    heading_style = ParagraphStyle(
        'HeadingStyle', parent=styles['Heading2'], fontName=font_bold, fontSize=12, spaceBefore=16, spaceAfter=8,
    )
    normal_style = ParagraphStyle(
        'NormalStyle', parent=styles['Normal'], fontName=font_regular, fontSize=11, leading=16, spaceAfter=10,
    )
    # Base style for table cells that mix the translated font with an
    # explicit <font face="Helvetica"> run via latin() above — the cell's
    # own fontName barely matters since every character ends up inside one
    # explicit <font> tag or another, but ReportLab still requires a base
    # style to construct the Paragraph.
    cell_style = ParagraphStyle('CellStyle', parent=styles['Normal'], fontName=font_regular, fontSize=11, leading=14)

    sub_label_style = ParagraphStyle(
        'SubLabelStyle', parent=styles['Normal'], fontName=font_bold, fontSize=10.5, spaceBefore=4, spaceAfter=4,
    )
    # Real bank application forms (SBI/IDFC/Kotak) mark every section with a
    # solid colored bar — "FORM-A (PERSONAL DETAILS)", "FORM-B (EMPLOYMENT &
    # INCOME DETAILS)", etc. This isn't a pixel copy of any one bank's form,
    # but the same visual device, in this platform's own brand navy (matches
    # theme.navy in the frontend's userPortalTheme.js) rather than a
    # specific bank's blue.
    BRAND_NAVY = colors.HexColor('#1E6091')
    ribbon_style = ParagraphStyle(
        'RibbonStyle', parent=styles['Normal'], fontName=font_bold, fontSize=11, textColor=colors.white, leading=14,
    )
    role_marks_style = ParagraphStyle(
        'RoleMarksStyle', parent=styles['Normal'], fontName=font_regular, fontSize=9.5, textColor=colors.white,
        leading=13,
    )

    def ribbon(text, sub_text=None):
        """A full-width colored section bar, optionally with a second line
        (used for the Applicant/Co-Applicant/Guarantor role-selector line,
        mirroring the "[tick one]" ribbon on the forms this is modeled on).
        `text`/`sub_text` are already-translated strings in the document's
        own font — never user input, so no latin() wrap needed here."""
        cells = [[Paragraph(text, ribbon_style)]]
        style_commands = [
            ('BACKGROUND', (0, 0), (-1, -1), BRAND_NAVY),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]
        if sub_text:
            cells.append([Paragraph(sub_text, role_marks_style)])
            # Row 1 only exists in this branch — referencing it when there's
            # just one row would index past the table.
            style_commands.append(('TOPPADDING', (0, 1), (-1, 1), 0))
        table = Table(cells, colWidths=[500])
        table.setStyle(TableStyle(style_commands))
        return table

    def kv_table(pairs):
        """pairs: list of (translated_label, already-markup-safe value
        string). Skips any pair whose value is empty/None."""
        rows = [[label, Paragraph(value, cell_style)] for label, value in pairs if value not in (None, "")]
        if not rows:
            return None
        table = Table(rows, colWidths=[170, 330])
        table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (0, -1), font_bold),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('PADDING', (0, 0), (-1, -1), 6),
        ]))
        return table

    def dyn_rows(source: dict, keys):
        """Pulls the given keys out of `source` — either req.dynamic_fields
        for loan-level fields, or a party sub-model's .model_dump() for
        per-party fields — in the given fixed order, translating each label.
        An unrecognized key still renders, just title-cased. Missing/blank
        keys are simply omitted."""
        out = []
        for k in keys:
            v = source.get(k)
            if v in (None, ""):
                continue
            label = (get_field_label(req.language, k) or k.replace("_", " ").title()) + ":"
            if k == "aadhaar_number":
                v = _mask_aadhaar(v)
            out.append((label, latin(v)))
        return out

    def rows_table(col_keys, rows):
        """Renders a repeatable-row party section (Income/Existing Loans/
        Bank Accounts/Assets/References) with translated column headers.
        None if `rows` is empty or every row in it is entirely blank."""
        if not rows:
            return None
        headers = [get_field_label(req.language, k) or k.replace("_", " ").title() for k in col_keys]
        data = [headers]
        for row in rows:
            row_d = row.model_dump()
            if all(row_d.get(k) in (None, "") for k in col_keys):
                continue
            data.append([Paragraph(latin(row_d.get(k) or ""), cell_style) for k in col_keys])
        if len(data) == 1:
            return None
        col_width = 500 / len(col_keys)
        table = Table(data, colWidths=[col_width] * len(col_keys))
        table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), font_bold),
            ('BACKGROUND', (0, 0), (-1, 0), BRAND_NAVY),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('PADDING', (0, 0), (-1, -1), 6),
        ]))
        return table

    # Computed values — application/account numbers are cosmetic document
    # references only (no backing "loan account" entity exists yet in this
    # system), regenerated fresh on every draft rather than persisted.
    application_no = f"{get_application_no_prefix(req.document_name)}-{uuid.uuid4().hex[:8].upper()}"
    account_no = f"{get_application_no_prefix(req.document_name)}A-{uuid.uuid4().hex[:8].upper()}"
    agreement_date = datetime.now()
    emi = _calc_emi(req.loan_amount, req.interest_rate, req.tenure)
    first_emi_date = _add_months(agreement_date, 1)
    try:
        final_emi_date = _add_months(agreement_date, int(float(req.tenure)))
    except (TypeError, ValueError):
        final_emi_date = None
    date_format = "%B %d, %Y" if req.language == "English" else "%d/%m/%Y"

    # `parties` always has exactly one "applicant" (enforced by
    # LoanDraftRequest._require_one_applicant); Terms clause 1 names the
    # Applicant plus any Co-Applicants as "the Borrower(s)" — Guarantors are
    # a separate party to the Agreement, not named there.
    applicant = next(p for p in req.parties if p.role == "applicant")
    co_applicant_names = [p.personal.full_name for p in req.parties if p.role == "co_applicant" and p.personal.full_name]
    borrower_names = applicant.personal.full_name or "Customer"
    if co_applicant_names:
        borrower_names += " and " + ", ".join(co_applicant_names)

    story = []

    # Title — boxed and centered, echoing the bordered title block on the
    # bank forms this is modeled on (e.g. "CAR LOAN / APPLICATION FORM" in a
    # box at the top of the SBI form). document_name (e.g. "Car Loan") is
    # always the English name from the shared `document` catalog table,
    # never translated.
    title_table = Table(
        [[Paragraph(f"{latin(req.document_name.upper(), bold=True)} {t['title_suffix']}", title_style)]],
        colWidths=[500],
    )
    title_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.2, BRAND_NAVY),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(title_table)
    story.append(Spacer(1, 16))

    # Loan Details — the letterhead-style summary block.
    ldf = t["loan_details_fields"]
    loan_details_table = kv_table([
        (ldf["agreement_date"], latin(agreement_date.strftime(date_format))),
        (ldf["application_no"], latin(application_no)),
        (ldf["account_no"], latin(account_no)),
        (ldf["loan_amount"], latin(f"Rs. {req.loan_amount}")),
        (ldf["interest_rate"], latin(f"{req.interest_rate}% p.a.")),
        (ldf["tenure"], f"{latin(req.tenure)} {t['months']}"),
        (ldf["repayment_frequency"], latin(req.repayment_frequency)),
        (ldf["emi_amount"], latin(f"Rs. {emi}") if emi is not None else None),
        (ldf["loan_purpose"], latin(req.document_name)),
    ])
    if loan_details_table:
        story.append(ribbon(t["section_headings"]["loan_details"]))
        story.append(loan_details_table)
        story.append(Spacer(1, 12))

    # One Form-A/Form-B style block per party — Applicant first, then every
    # Co-Applicant, then every Guarantor, regardless of the order they were
    # added in the UI (mirrors the real bank forms this was modeled on).
    ADDRESS_KEYS = [
        "house_no", "street", "landmark", "city", "district", "state", "pincode", "country", "mobile", "email",
    ]
    PERSONAL_KEYS = [
        "full_name", "gender", "date_of_birth", "marital_status", "spouse_name", "father_name",
        "mother_maiden_name", "category", "religion", "nationality", "residential_status",
        "no_of_dependents", "occupation", "pan_number", "aadhaar_number", "voter_id",
        "driving_license", "passport_number", "passport_valid_upto",
    ]
    EMPLOYMENT_KEYS = [
        "occupation_type", "employer_name", "designation", "department", "employee_no",
        "employment_status", "organization_type", "total_experience", "years_present_job",
        "business_name", "business_type", "monthly_income",
    ]

    role_order = ["applicant", "co_applicant", "guarantor"]
    ordered_parties = sorted(req.parties, key=lambda p: role_order.index(p.role))
    role_total = {role: sum(1 for p in ordered_parties if p.role == role) for role in role_order}
    role_seen: dict[str, int] = {}
    signature_entries = []  # (caption, latin-wrapped name) per party, for the Signatures section below

    for party in ordered_parties:
        role_suffix = ""
        if party.role != "applicant":
            role_seen[party.role] = role_seen.get(party.role, 0) + 1
            if role_total[party.role] > 1:
                role_suffix = f" {role_seen[party.role]}"
        signature_entries.append(
            (t["signature_captions"][party.role] + role_suffix, latin(party.personal.full_name))
        )

        # Role-selector line under the ribbon — "[X] Applicant  [ ] Co-Applicant
        # [ ] Guarantor" — mirrors the tick-one-box ribbon at the top of
        # Form-A/Form-B on the bank forms this is modeled on. Plain ASCII
        # brackets rather than Unicode checkbox glyphs (☐/☑), since the base14
        # Helvetica font and the vendored Noto subsets aren't guaranteed to
        # include those glyphs.
        role_marks = "     ".join(
            f"[{'X' if r == party.role else ' '}] {t['party_roles'][r]}" for r in role_order
        )
        story.append(Spacer(1, 14))
        story.append(ribbon(t["party_roles"][party.role] + role_suffix, sub_text=role_marks))

        personal_table = kv_table(dyn_rows(party.personal.model_dump(), PERSONAL_KEYS))
        if personal_table:
            story.append(ribbon(t["section_headings"]["personal_kyc"]))
            story.append(personal_table)
            story.append(Spacer(1, 10))

        present_table = kv_table(dyn_rows(party.address.present.model_dump(), ADDRESS_KEYS))
        permanent_table = None
        if not party.address.permanent_same_as_present and party.address.permanent:
            permanent_table = kv_table(dyn_rows(party.address.permanent.model_dump(), ADDRESS_KEYS))
        office_table = None
        if party.address.office:
            office_table = kv_table(dyn_rows(party.address.office.model_dump(), ADDRESS_KEYS))
        if present_table or permanent_table or office_table:
            story.append(ribbon(t["section_headings"]["address"]))
            if present_table:
                story.append(Paragraph(t["present_address"], sub_label_style))
                story.append(present_table)
                story.append(Spacer(1, 6))
            if permanent_table:
                story.append(Paragraph(t["permanent_address"], sub_label_style))
                story.append(permanent_table)
                story.append(Spacer(1, 6))
            if office_table:
                story.append(Paragraph(t["office_address"], sub_label_style))
                story.append(office_table)
            story.append(Spacer(1, 10))

        employment_table = kv_table(dyn_rows(party.employment.model_dump(), EMPLOYMENT_KEYS))
        if employment_table:
            story.append(ribbon(t["section_headings"]["party_employment"]))
            story.append(employment_table)
            story.append(Spacer(1, 10))

        for section_key, col_keys, rows in [
            ("income_sources", ["income_head", "gross_income", "net_income", "frequency"], party.income_sources),
            ("party_existing_loans",
             ["loan_bank", "loan_type", "loan_emi", "loan_tenure", "loan_outstanding"], party.existing_loans),
            ("party_bank_accounts",
             ["bank_name", "bank_branch", "account_type", "account_number"], party.bank_accounts),
            ("party_assets", ["asset_type", "asset_description", "asset_value"], party.assets),
            ("party_references",
             ["reference_name", "reference_address", "reference_phone"], party.references),
        ]:
            table = rows_table(col_keys, rows)
            if table:
                story.append(ribbon(t["section_headings"][section_key]))
                story.append(table)
                story.append(Spacer(1, 10))

    # Loan-type-specific section(s) — Property/Vehicle/Financial/Farm+Crop,
    # per LOAN_TYPE_CONFIG. These describe the loan itself, not a party, so
    # they stay in the flat req.dynamic_fields dict.
    for section_key, field_keys in type_config["sections"]:
        section_table = kv_table(dyn_rows(req.dynamic_fields, field_keys))
        if section_table:
            story.append(ribbon(t["section_headings"][section_key]))
            story.append(section_table)
            story.append(Spacer(1, 12))

    # Repayment & Security — computed EMI dates plus the type-specific
    # security fields (mortgage/hypothecation/collateral/...).
    repayment_rows = []
    if emi is not None:
        repayment_rows.append((t["first_emi_date"], latin(first_emi_date.strftime(date_format))))
        if final_emi_date:
            repayment_rows.append((t["final_emi_date"], latin(final_emi_date.strftime(date_format))))
    repayment_rows += dyn_rows(req.dynamic_fields, type_config["repayment_security"])
    repayment_table = kv_table(repayment_rows)
    if repayment_table:
        story.append(ribbon(t["section_headings"]["repayment_security"]))
        story.append(repayment_table)
        story.append(Spacer(1, 12))

    # 10 numbered Terms clauses — {name} is the only user data embedded
    # mid-paragraph in the translated boilerplate, so it's the only run
    # that needs the explicit Helvetica wrap.
    story.append(Spacer(1, 8))
    for i, heading in enumerate(t["terms_headings"][:-1], start=1):  # last one is Signatures, handled separately
        story.append(Paragraph(heading, heading_style))
        body = t["terms_bodies"][i]
        if i == 1:
            body = body.format(name=latin(borrower_names, bold=True))
        story.append(Paragraph(body, normal_style))

    story.append(Spacer(1, 30))

    # Signatures — one column per party, chunked 3-wide (mirrors how SBI's
    # own forms lay Applicant/Co-Applicant/Guarantor signature lines out
    # side by side), plus a final standalone line for the Lender.
    story.append(Paragraph(t["terms_headings"][-1], heading_style))
    story.append(Paragraph(t["witness"], normal_style))
    story.append(Spacer(1, 30))

    def sig_block(entries):
        """entries: list of (caption, already-markup-safe name string)."""
        col_width = 500 / len(entries)
        line_row = ["_________________________"] * len(entries)
        caption_row = [caption for caption, _ in entries]
        name_row = [Paragraph(f"{t['name_label']} {name}", cell_style) for _, name in entries]
        table = Table([line_row, caption_row, name_row], colWidths=[col_width] * len(entries))
        table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica'),
            ('FONTNAME', (0, 1), (-1, 1), font_regular),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        return table

    for i in range(0, len(signature_entries), 3):
        story.append(sig_block(signature_entries[i:i + 3]))
        story.append(Spacer(1, 20))
    story.append(sig_block([(t["lender_signatory"], t["lender_name"])]))

    # Build PDF
    doc.build(story)

    pdf_bytes = buffer.getvalue()
    buffer.close()

    return Response(content=pdf_bytes, media_type="application/pdf")


@router.get("/loans/documents")
def get_loan_document_checklist(
    document_name: str,
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> list[dict[str, Any]]:
    """Document checklist for a loan type — hardcoded per loan type (see
    app/loan_i18n.py's DOCUMENT_CHECKLISTS), the same way every other part
    of this flow's field set is (LOAN_TYPE_CONFIG). There's a separate
    admin-managed `loan_document_config` DB table with full CRUD
    (app/routes/loan_documents.py) that could drive this instead, but no
    admin screen anywhere in this app writes to it, so depending on it
    would just show every partner user an empty checklist. Used by the Loan
    Application flow's Documents Checklist step; each item's
    `applicant_type` says which party roles (applicant/co_applicant/
    guarantor) it applies to, so the frontend filters to only the roles
    actually present on this application."""
    from app.loan_i18n import get_default_document_checklist

    return get_default_document_checklist(document_name)

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
    loan_details: str | None = Form(None),
    current_partner_user: dict[str, Any] = Depends(get_current_partner_user),
) -> dict[str, Any]:
    # organization_user_id is always the caller's own membership — a Partner
    # User can only ever create orders for themselves, never on behalf of
    # another user in the org. Assignment is only enforced for Dealer-type
    # orgs (Cyber Shop accounts); a Retailer's member IS the organization, so
    # it may use any service Super Admin activated for the org — see
    # list_my_services above.
    parsed_loan_details: dict[str, Any] | None = None
    if loan_details:
        try:
            parsed_loan_details = json.loads(loan_details)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail="loan_details must be valid JSON") from e
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
        loan_details=parsed_loan_details,
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
