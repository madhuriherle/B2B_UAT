import base64
import logging
import os
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from psycopg.types.json import Jsonb

from app.database import get_connection, get_transaction
from app.esign_service import ORDER_UPLOAD_DIR, _auto_generate_invoice_on_completion, _is_valid_pdf_bytes
from app.karnataka_article_codes import ARTICLE_BY_DIGITAL_CODE_BY_STATE, SHCIL_STATE_CODES, resolve_article
from app.maharashtra_esbtr_districts import maharashtra_district_code, resolve_maharashtra_district
from app.notification_service import notify_estamp_status
from app.organization_state import resolve_stamp_state_code
from app.routes.partner import _block_wallet_amount, _convert_block_to_debit, _release_wallet_block
from app.signdesk_stamp import (
    SignDeskStampError,
    new_reference_id,
    request_stamp_paper,
    request_stamp_paper_otf,
)
from app.validators import validate_mobile

logger = logging.getLogger(__name__)

STAMPED_UPLOAD_DIR = ORDER_UPLOAD_DIR / "stamped"

# The service_name orders.service_name gets set to when created via the
# "eStamp On The Fly" (Karnataka) form — see PartnerUserCreateOrder.jsx /
# PartnerCreateOrder.jsx's isEStampOnTheFly branch. Deliberately distinct
# from plain "eStamp" (see _get_order_for_stamp below) so the two flows'
# state machines/routes can never cross-apply to each other's orders.
OTF_SERVICE_NAME = "eStamp On The Fly"

# Which first_party_id_type / second_party_id_type values are valid for a
# given entity_type — see the DSS 2.0 API doc's first_party_id_type /
# second_party_id_type parameter descriptions.
ID_TYPES_BY_ENTITY = {
    "Individual": {"DLN", "PAN", "PPN", "VID", "UID"},
    "Organization": {"PAN"},
    "Government": {"TAN"},
    "Foreign": {"FID"},
}


class Address(BaseModel):
    street_address: str
    locality: str | None = None
    city: str
    state: str
    pincode: str | None = None
    country: str | None = None


class PartyDetails(BaseModel):
    name: str
    entity_type: str
    id_type: str
    id_number: str
    phone: str | None = None
    address: Address

    @field_validator("entity_type")
    @classmethod
    def _validate_entity_type(cls, value: str) -> str:
        if value not in ID_TYPES_BY_ENTITY:
            raise ValueError(f"entity_type must be one of {sorted(ID_TYPES_BY_ENTITY)}")
        return value

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str | None) -> str | None:
        return validate_mobile(value)

    @model_validator(mode="after")
    def _validate_id_type_for_entity(self) -> "PartyDetails":
        allowed = ID_TYPES_BY_ENTITY.get(self.entity_type, set())
        if self.id_type not in allowed:
            raise ValueError(f"id_type for entity_type '{self.entity_type}' must be one of {sorted(allowed)}")
        return self


STAMP_DUTY_PAYERS = {"First Party", "Second Party"}


class StampInitiateRequest(BaseModel):
    # Picked per order on the create-order form now, not resolved from the
    # organization's onboarding state — see organization_state.resolve_stamp_state_code,
    # called from initiate_stamp below, which raises if it's a state SignDesk
    # doesn't support.
    stamp_state: str
    document_category: int
    stamp_amount: float
    consideration_amount: float
    stamp_duty_paid_by: str
    first_party: PartyDetails
    second_party: PartyDetails
    duty_payer_phone_number: str
    duty_payer_email_id: EmailStr | None = None
    surcharge: float | None = None

    @field_validator("stamp_duty_paid_by")
    @classmethod
    def _validate_paid_by(cls, value: str) -> str:
        if value not in STAMP_DUTY_PAYERS:
            raise ValueError(f"stamp_duty_paid_by must be one of {sorted(STAMP_DUTY_PAYERS)}")
        return value

    @field_validator("duty_payer_phone_number")
    @classmethod
    def _validate_duty_payer_phone(cls, value: str) -> str:
        validate_mobile(value)
        return value

    @field_validator("stamp_amount", "consideration_amount")
    @classmethod
    def _validate_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("must be greater than 0")
        return value

    @model_validator(mode="after")
    def _validate_conditional_fields(self) -> "StampInitiateRequest":
        if self.stamp_duty_paid_by == "Second Party" and not self.duty_payer_email_id:
            raise ValueError("duty_payer_email_id is required when stamp_duty_paid_by is 'Second Party'")
        # The Rajasthan-specific surcharge requirement is checked in
        # initiate_stamp instead, once the organization's stamp_state is
        # resolved server-side — this model no longer carries stamp_state.
        return self


SHCIL_OTF_STATES = set(SHCIL_STATE_CODES)  # Karnataka, Tamil Nadu, Delhi — see karnataka_article_codes.py
ESBTR_OTF_STATES = {"Maharashtra"}
OTF_STATES = SHCIL_OTF_STATES | ESBTR_OTF_STATES


class EsbtrPropertyAddress(BaseModel):
    addressline_1: str
    road: str
    town_village: str
    district: str
    pincode: str


class EsbtrDetails(BaseModel):
    district: str
    sub_registrar_office: str
    property_address: EsbtrPropertyAddress
    property_area: str
    property_area_unit: str

    @field_validator("property_area_unit")
    @classmethod
    def _validate_area_unit(cls, value: str) -> str:
        allowed = {"Sq.Meter", "Sq.Feet", "Acres", "Guntha", "Hectare"}
        if value not in allowed:
            raise ValueError(f"property_area_unit must be one of {sorted(allowed)}")
        return value

    @model_validator(mode="after")
    def _validate_office_for_district(self) -> "EsbtrDetails":
        offices = resolve_maharashtra_district(self.district)
        if self.sub_registrar_office not in offices:
            raise ValueError(f"'{self.sub_registrar_office}' is not a sub-registrar office of {self.district}")
        return self


class StampOtfInitiateRequest(BaseModel):
    """"eStamp On The Fly" request body — same shape as StampInitiateRequest
    above minus the general 21-state stamp_state (this credential set only
    covers the OTF_STATES below) and surcharge (Rajasthan-only per the DSS
    2.0 doc, not relevant here).

    SHCIL_OTF_STATES (Karnataka, Tamil Nadu, Delhi) orders carry
    digital_article_code instead of document_category — each configured
    article maps to exactly one document_category on this account (see
    karnataka_article_codes.py), so document_category is derived
    server-side from digital_article_code alone, never client-supplied. A
    client-sent document_category for one of these states is ignored, not
    validated — there is deliberately no "these don't match" error, since
    the correct value is looked up, not checked.

    ESBTR_OTF_STATES (Maharashtra) orders carry document_category (still
    client-supplied — no equivalent article mapping has been configured for
    Maharashtra/eSBTR yet) and esbtr_details instead of an article code."""

    stamp_state: str
    document_category: int | None = None
    digital_article_code: str | None = None
    esbtr_details: EsbtrDetails | None = None
    stamp_amount: float
    consideration_amount: float
    stamp_duty_paid_by: str
    first_party: PartyDetails
    second_party: PartyDetails
    duty_payer_phone_number: str
    duty_payer_email_id: EmailStr | None = None

    @field_validator("stamp_state")
    @classmethod
    def _validate_state(cls, value: str) -> str:
        if value not in OTF_STATES:
            raise ValueError(f"stamp_state must be one of {sorted(OTF_STATES)}")
        return value

    @field_validator("stamp_duty_paid_by")
    @classmethod
    def _validate_paid_by(cls, value: str) -> str:
        if value not in STAMP_DUTY_PAYERS:
            raise ValueError(f"stamp_duty_paid_by must be one of {sorted(STAMP_DUTY_PAYERS)}")
        return value

    @field_validator("duty_payer_phone_number")
    @classmethod
    def _validate_duty_payer_phone(cls, value: str) -> str:
        validate_mobile(value)
        return value

    @field_validator("stamp_amount", "consideration_amount")
    @classmethod
    def _validate_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("must be greater than 0")
        return value

    @model_validator(mode="after")
    def _validate_conditional_fields(self) -> "StampOtfInitiateRequest":
        if self.stamp_duty_paid_by == "Second Party" and not self.duty_payer_email_id:
            raise ValueError("duty_payer_email_id is required when stamp_duty_paid_by is 'Second Party'")
        if self.stamp_state in SHCIL_OTF_STATES:
            if not self.digital_article_code:
                raise ValueError(f"digital_article_code is required when stamp_state is {self.stamp_state}")
            # A plain ValueError here (not resolve_article's HTTPException) —
            # Pydantic validators must raise ValueError/TypeError/
            # AssertionError for FastAPI to turn this into a clean 422.
            # Checked against this specific state's list (not a flat
            # cross-state set) — see resolve_article's own docstring.
            if self.digital_article_code not in ARTICLE_BY_DIGITAL_CODE_BY_STATE.get(self.stamp_state, {}):
                raise ValueError(f"'{self.digital_article_code}' is not a recognized {self.stamp_state} article code.")
        elif self.stamp_state in ESBTR_OTF_STATES:
            if not self.esbtr_details:
                raise ValueError(f"esbtr_details is required when stamp_state is {self.stamp_state}")
            if not self.document_category:
                raise ValueError(f"document_category is required when stamp_state is {self.stamp_state}")
        return self


def _get_order_for_stamp(connection, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    order = connection.execute(
        """
        SELECT o.id, o.order_no, o.service_name, o.document_filename, o.document_path, o.organization_user_id,
               o.stamp_value_wallet_debited, org.payment_mode
        FROM orders o
        JOIN organizations org ON org.id = o.organization_id
        WHERE o.id = %s AND o.organization_id = %s
        """,
        (order_id, organization_id),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["service_name"] != "eStamp":
        raise HTTPException(status_code=400, detail="This order is not an eStamp order")
    if not order["document_path"]:
        raise HTTPException(status_code=400, detail="Order has no document to stamp")
    return order


def _get_order_for_stamp_otf(connection, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    """Same shape/query as _get_order_for_stamp above, gated on the "eStamp
    On The Fly" service_name instead of plain "eStamp" — kept as a separate
    function (rather than parameterizing _get_order_for_stamp) so the two
    services' order-eligibility checks can never accidentally accept each
    other's orders."""
    order = connection.execute(
        """
        SELECT o.id, o.order_no, o.service_name, o.document_filename, o.document_path, o.organization_user_id,
               o.stamp_value_wallet_debited, org.payment_mode
        FROM orders o
        JOIN organizations org ON org.id = o.organization_id
        WHERE o.id = %s AND o.organization_id = %s
        """,
        (order_id, organization_id),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["service_name"] != OTF_SERVICE_NAME:
        raise HTTPException(status_code=400, detail="This order is not an eStamp On The Fly order")
    if not order["document_path"]:
        raise HTTPException(status_code=400, detail="Order has no document to stamp")
    return order


def _amount_str(value: float) -> str:
    """Formats a rupee amount for SignDesk's stamp_amount/consideration_amount
    fields — plain digits only ("1000"), never "1000.0". Confirmed live
    against SignDesk UAT: str(1000.0) == "1000.0" was rejected with ds-122
    ("The stamp_amount passed in the request is invalid.") — these fields
    are documented as whole-rupee denominations, no paise, so truncating via
    int() is correct, not lossy for any real input."""
    return str(int(value))


def _address_payload(address: Address) -> dict[str, Any]:
    # locality/pincode/country are documented as optional — omit them
    # entirely when blank rather than sending an empty string, since an API
    # that unconditionally does something like int(pincode) on its end could
    # choke on "" in a way it wouldn't on a genuinely absent key.
    payload: dict[str, Any] = {
        "street_address": address.street_address,
        "city": address.city,
        "state": address.state,
    }
    if address.locality:
        payload["locality"] = address.locality
    if address.pincode:
        payload["pincode"] = address.pincode
    if address.country:
        payload["country"] = address.country
    return payload


def _build_request_payload(body: StampInitiateRequest, stamp_state_code: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "first_party_name": body.first_party.name,
        "second_party_name": body.second_party.name,
        "duty_payer_phone_number": body.duty_payer_phone_number,
        "first_party_address": _address_payload(body.first_party.address),
        "second_party_address": _address_payload(body.second_party.address),
        "stamp_amount": [str(body.stamp_amount)],
        "consideration_amount": str(body.consideration_amount),
        "stamp_state": stamp_state_code,
        "stamp_duty_paid_by": body.stamp_duty_paid_by,
        "document_category": [str(body.document_category)],
        "first_party_details": {
            "first_party_entity_type": body.first_party.entity_type,
            "first_party_id_type": body.first_party.id_type,
            "first_party_id_number": body.first_party.id_number,
        },
        "second_party_details": {
            "second_party_entity_type": body.second_party.entity_type,
            "second_party_id_type": body.second_party.id_type,
            "second_party_id_number": body.second_party.id_number,
        },
    }
    # first/second_party_phone_number, duty_payer_email_id, surcharge are all
    # documented as optional — same reasoning as the address fields above:
    # omit rather than send an empty/None placeholder.
    if body.first_party.phone:
        payload["first_party_phone_number"] = body.first_party.phone
    if body.second_party.phone:
        payload["second_party_phone_number"] = body.second_party.phone
    if body.duty_payer_email_id:
        payload["duty_payer_email_id"] = body.duty_payer_email_id
    if body.surcharge is not None:
        payload["surcharge"] = [str(body.surcharge)]
    return payload


def _build_request_payload_otf(body: StampOtfInitiateRequest) -> dict[str, Any]:
    """"eStamp On The Fly" payload — same field-for-field mapping as
    _build_request_payload above, branching on stamp_state:

    - SHCIL_OTF_STATES (Karnataka, Tamil Nadu, Delhi): stamp_state is that
      state's 2-letter code, stamp_type="shcil", document_category DERIVED
      from digital_article_code via karnataka_article_codes.py's
      per-state mapping — never body.document_category, which is ignored
      entirely for these states (see StampOtfInitiateRequest's docstring).
      Deliberately does NOT send digital_article_code/article_number as
      request fields — the documented DSS 2.0 request body has no such
      field, only document_category. The article code itself is stored in
      b2b_stamp_transaction for our own audit trail only (see
      initiate_stamp_otf).
    - ESBTR_OTF_STATES (Maharashtra): stamp_state="MH", stamp_type="eSBTR",
      body.document_category as client-supplied (no article mapping
      configured for Maharashtra yet), plus esbtr_details — this one IS a
      documented request field (see the DSS 2.0 doc's esbtr_detail
      section)."""
    payload: dict[str, Any] = {
        "first_party_name": body.first_party.name,
        "second_party_name": body.second_party.name,
        "duty_payer_phone_number": body.duty_payer_phone_number,
        "first_party_address": _address_payload(body.first_party.address),
        "second_party_address": _address_payload(body.second_party.address),
        "stamp_amount": [_amount_str(body.stamp_amount)],
        "consideration_amount": _amount_str(body.consideration_amount),
        "stamp_duty_paid_by": body.stamp_duty_paid_by,
        "first_party_details": {
            "first_party_entity_type": body.first_party.entity_type,
            "first_party_id_type": body.first_party.id_type,
            "first_party_id_number": body.first_party.id_number,
        },
        "second_party_details": {
            "second_party_entity_type": body.second_party.entity_type,
            "second_party_id_type": body.second_party.id_type,
            "second_party_id_number": body.second_party.id_number,
        },
    }
    # This account's Karnataka config requires a surcharge value even though
    # the DSS 2.0 doc documents it as Rajasthan-only (ds-311: "No surcharges
    # value found for the state in the request", confirmed live against
    # SignDesk UAT). "0" was rejected too — SignDesk's live error named the
    # only accepted value explicitly ("The provided surcharge value is
    # invalid... Allowed value(s): 300"), so this is a fixed, account-
    # configured constant, not a real percentage/cess computed from the
    # transaction — same array-of-string-numbers shape as stamp_amount.
    payload["surcharge"] = ["300"]
    if body.stamp_state in SHCIL_OTF_STATES:
        article = resolve_article(body.stamp_state, body.digital_article_code)
        payload["document_category"] = [str(article["document_category"])]
        payload["stamp_state"] = SHCIL_STATE_CODES[body.stamp_state]
        # SignDesk confirmed (support thread, 2026-09-02) their own working
        # example for Karnataka On The Fly uses stamp_type "shcil", not
        # "estamp" — consistent with Karnataka's on-the-fly service being
        # SHCIL-based (see the shcilestamp.com reference for this state in
        # the Document Category & Article Code Annexure). Sending "estamp"
        # here was almost certainly what caused the sh-145 "Unknown
        # Exception" failures. Applied to every SHCIL state, not just
        # Karnataka, on the same reasoning.
        payload["stamp_type"] = "shcil"
    else:
        payload["document_category"] = [str(body.document_category)]
        payload["stamp_state"] = "MH"
        payload["stamp_type"] = "eSBTR"
        esbtr = body.esbtr_details
        payload["esbtr_details"] = {
            # SignDesk's Annexure 3 keys every district by a numeric-prefixed
            # code ("2201-PUNE", not bare "PUNE") — confirmed live via ds-179
            # ("district and sub_registrar_office values are not matching")
            # when sending the bare name. See maharashtra_district_code.
            "district": maharashtra_district_code(esbtr.district),
            "sub_registrar_office": esbtr.sub_registrar_office.upper(),
            "property_address": {
                "addressline_1": esbtr.property_address.addressline_1,
                "road": esbtr.property_address.road,
                "town_village": esbtr.property_address.town_village,
                "district": esbtr.property_address.district,
                "pincode": esbtr.property_address.pincode,
            },
            "property_area": esbtr.property_area,
            "property_area_unit": esbtr.property_area_unit,
        }
    if body.first_party.phone:
        payload["first_party_phone_number"] = body.first_party.phone
    if body.second_party.phone:
        payload["second_party_phone_number"] = body.second_party.phone
    if body.duty_payer_email_id:
        payload["duty_payer_email_id"] = body.duty_payer_email_id
    return payload


def _save_stamped_pdf(*, order_id: UUID, content_b64: str) -> str | None:
    """Persists the stamped PDF when SignDesk returns it directly in the
    request response (the synchronous/on-the-fly case). Never raises — a bad
    payload must not block recording the transaction status, same reasoning
    as esign_service._save_signed_pdf, which this mirrors."""
    try:
        pdf_bytes = base64.b64decode(content_b64, validate=True)
    except Exception:
        logger.error("eStamp response for order %s included unparseable base64 PDF content — discarding.", order_id)
        return None

    if not _is_valid_pdf_bytes(pdf_bytes):
        logger.error(
            "eStamp response for order %s included content that doesn't look like a valid PDF "
            "(got %d bytes, missing %%PDF- header) — discarding.",
            order_id, len(pdf_bytes),
        )
        return None

    try:
        STAMPED_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{order_id}.pdf"
        final_path = STAMPED_UPLOAD_DIR / filename
        tmp_path = STAMPED_UPLOAD_DIR / f".{filename}.{uuid4().hex[:8]}.tmp"
        tmp_path.write_bytes(pdf_bytes)
        os.replace(tmp_path, final_path)
    except OSError:
        logger.exception("Failed to write stamped PDF to disk for order %s", order_id)
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        return None

    logger.info("Stored stamped PDF for order %s (%d bytes) at %s", order_id, len(pdf_bytes), final_path)
    return filename


def _upsert_transaction(
    *,
    order_id: UUID,
    reference_id: str,
    stamp_state: str,
    document_category: int,
    stamp_amount: float,
    consideration_amount: float,
    status: str,
    signdesk_transaction_id: str | None = None,
    signdesk_order_id: str | None = None,
    stamp_paper_number: str | None = None,
    stamp_duty_amount: float | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    raw_response: dict[str, Any] | None = None,
    stamped_file_path: str | None = None,
    article_number: str | None = None,
    digital_article_code: str | None = None,
) -> None:
    # article_number/digital_article_code stay NULL for plain eStamp orders
    # (callers never pass them) — only "eStamp On The Fly" (see
    # initiate_stamp_otf) populates them.
    with get_transaction() as connection:
        connection.execute(
            """
            INSERT INTO b2b_stamp_transaction (
                order_id, reference_id, stamp_state, document_category, stamp_amount, consideration_amount,
                status, signdesk_transaction_id, signdesk_order_id, stamp_paper_number, stamp_duty_amount,
                error_code, error_message, raw_response, stamped_file_path, article_number, digital_article_code, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (order_id) DO UPDATE SET
                reference_id = EXCLUDED.reference_id,
                stamp_state = EXCLUDED.stamp_state,
                document_category = EXCLUDED.document_category,
                stamp_amount = EXCLUDED.stamp_amount,
                consideration_amount = EXCLUDED.consideration_amount,
                status = EXCLUDED.status,
                signdesk_transaction_id = EXCLUDED.signdesk_transaction_id,
                signdesk_order_id = EXCLUDED.signdesk_order_id,
                stamp_paper_number = EXCLUDED.stamp_paper_number,
                stamp_duty_amount = EXCLUDED.stamp_duty_amount,
                error_code = EXCLUDED.error_code,
                error_message = EXCLUDED.error_message,
                raw_response = EXCLUDED.raw_response,
                stamped_file_path = COALESCE(EXCLUDED.stamped_file_path, b2b_stamp_transaction.stamped_file_path),
                article_number = EXCLUDED.article_number,
                digital_article_code = EXCLUDED.digital_article_code,
                updated_at = now()
            """,
            (
                order_id, reference_id, stamp_state, document_category, stamp_amount, consideration_amount,
                status, signdesk_transaction_id, signdesk_order_id, stamp_paper_number, stamp_duty_amount,
                error_code, error_message, Jsonb(raw_response) if raw_response is not None else None,
                stamped_file_path, article_number, digital_article_code,
            ),
        )


def _debit_stamp_value(*, order_id: UUID, organization_id: UUID, organization_user_id: UUID | None, amount: float, order_id_str: str) -> None:
    """Converts this order's placement-time block (see initiate_stamp) into
    a real debit from the eStamp reimbursement wallet once SignDesk has
    accepted the request, and marks the order so invoice_service._resolve_
    order_invoice knows this order's stamp value was already prefunded at
    wallet-recharge time — never invoice it again. Only ever called once
    per order (guarded by stamp_value_wallet_debited itself, checked by the
    caller before request_stamp_paper runs)."""
    with get_transaction() as connection:
        _convert_block_to_debit(
            connection,
            organization_id=organization_id,
            organization_user_id=organization_user_id,
            amount=amount,
            order_id=order_id,
            description=f"eStamp order {order_id_str} · Stamp Value",
        )
        connection.execute(
            "UPDATE orders SET stamp_value_wallet_debited = true, updated_at = now() WHERE id = %s",
            (order_id,),
        )


def _signdesk_error_detail(e: SignDeskStampError) -> str:
    # SignDesk's DSS 2.0 API doc (Annexure 4) documents every failure as a
    # "ds-NNN" code + message pair — the bare message alone (e.g. "Unknown
    # Exception.") is one of several near-identical generic codes (ds-327,
    # ds-341, ds-464, ds-566), so surfacing the code lets a future SignDesk
    # support ticket pinpoint which one actually fired instead of guessing
    # from the message text alone.
    if e.error_code and e.error_code not in ("NA", None):
        return f"{e} (SignDesk error code: {e.error_code})"
    return str(e)


def initiate_stamp(*, order_id: UUID, organization_id: UUID, body: StampInitiateRequest) -> dict[str, Any]:
    # Raises if the client-picked state is one eStamp doesn't support.
    stamp_state_code = resolve_stamp_state_code(body.stamp_state)
    if stamp_state_code == "RJ" and body.surcharge is None:
        raise HTTPException(status_code=400, detail="Surcharge is required for Rajasthan (RJ)")

    with get_connection() as connection:
        order = _get_order_for_stamp(connection, order_id, organization_id)

    # eStamp reimbursement wallet model: only the real stamp/denomination
    # value is ever deducted here, and only once per order — PPS orgs never
    # touch the wallet (billed per service instead, same as every other PPS
    # order), and an order already marked stamp_value_wallet_debited means a
    # previous initiate call on this same order already paid for it (e.g. a
    # retry after a transient failure must not double-debit).
    charge_wallet = (order["payment_mode"] or "Wallet") != "PPS" and not order["stamp_value_wallet_debited"]

    pdf_path = ORDER_UPLOAD_DIR / order["document_path"]
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded document not found on server")
    pdf_bytes = pdf_path.read_bytes()

    order_id_str = str(order_id)
    reference_id = new_reference_id(order_id_str)
    payload = _build_request_payload(body, stamp_state_code)

    if charge_wallet:
        # Reserves the requested stamp amount right before calling SignDesk —
        # an actual block (raises the same insufficient-balance error a
        # cheap pre-check used to, just computed against AVAILABLE balance
        # rather than raw balance), so this money can't also be committed to
        # another pending order in the meantime. Released on SignDesk
        # failure below, or converted to a real debit on success (see
        # _debit_stamp_value) — resolved synchronously within this one call
        # either way, since a single eStamp request has no separate "Admin
        # marks Completed" step the way eStamp Bulk/Manual eStamp do.
        with get_transaction() as connection:
            _block_wallet_amount(
                connection,
                organization_id=organization_id, organization_user_id=order["organization_user_id"],
                amount=body.stamp_amount, order_id=order_id,
                description=f"eStamp order {order_id} · Stamp Value (blocked)",
            )

    try:
        response = request_stamp_paper(
            reference_id=reference_id,
            content_b64=base64.b64encode(pdf_bytes).decode("ascii"),
            payload=payload,
        )
        if response.get("status") != "success":
            raise SignDeskStampError(
                response.get("message") or f"SignDesk stamp request failed: {response}",
                error_code=response.get("error_code"), raw_response=response,
            )
    except SignDeskStampError as e:
        if charge_wallet:
            with get_transaction() as connection:
                _release_wallet_block(
                    connection,
                    organization_id=organization_id, organization_user_id=order["organization_user_id"],
                    amount=body.stamp_amount, order_id=order_id,
                )
        _upsert_transaction(
            order_id=order_id, reference_id=reference_id, stamp_state=stamp_state_code,
            document_category=body.document_category, stamp_amount=body.stamp_amount,
            consideration_amount=body.consideration_amount, status="failed",
            error_message=str(e), error_code=e.error_code, raw_response=e.raw_response or {"error": str(e)},
        )
        # Without this, orders.status stays wherever order creation left it
        # (e.g. "Submitted") forever — Order Reports' Pending/Processing/
        # Completed relabel (list_order_reports) then shows a permanently
        # dead order as "Pending", implying it's still awaiting action, and
        # Order Detail keeps offering "Generate Invoice" for something that
        # can never be invoiced. This route is single/API eStamp only (see
        # _get_order_for_stamp), so unlike eSign's shared initiate_esign
        # there's no "already-completed sibling service" to protect —
        # always safe to mark Failed here.
        with get_transaction() as connection:
            connection.execute(
                "UPDATE orders SET status = 'Failed', updated_at = now() WHERE id = %s",
                (order_id,),
            )
        notify_estamp_status(
            organization_id=organization_id, organization_user_id=order["organization_user_id"],
            order_id=order_id, order_no=order["order_no"], status="Failed",
        )
        raise HTTPException(status_code=502, detail=_signdesk_error_detail(e)) from e

    if charge_wallet:
        _debit_stamp_value(
            order_id=order_id, organization_id=organization_id, organization_user_id=order["organization_user_id"],
            amount=body.stamp_amount, order_id_str=order_id_str,
        )

    stamped_content = response.get("content")
    stamped_file_path = None
    status = "processing"
    if stamped_content:
        stamped_file_path = _save_stamped_pdf(order_id=order_id, content_b64=stamped_content)
        status = "completed"

    _upsert_transaction(
        order_id=order_id, reference_id=reference_id, stamp_state=stamp_state_code,
        document_category=body.document_category, stamp_amount=body.stamp_amount,
        consideration_amount=body.consideration_amount, status=status,
        signdesk_transaction_id=response.get("transaction_id"), signdesk_order_id=response.get("order_id"),
        stamp_paper_number=str(response.get("stamp_paper_number")) if response.get("stamp_paper_number") else None,
        stamp_duty_amount=response.get("stamp_duty_amount") or None,
        error_code=response.get("error_code"), raw_response=response, stamped_file_path=stamped_file_path,
    )

    # "processing" is an intermediate state (SignDesk hasn't returned the
    # stamped content yet) — stays silent, same terminal-only rule as every
    # other status notification in this feature.
    if status == "completed":
        notify_estamp_status(
            organization_id=organization_id, organization_user_id=order["organization_user_id"],
            order_id=order_id, order_no=order["order_no"], status="Completed",
        )

        # Optimistically completes the order the moment the stamp itself is
        # done, on the assumption that no eSign will follow — true for the
        # overwhelming majority of eStamp orders. If the caller does go on to
        # request eSign on top of this same order (PartnerUserCreateOrder.jsx's
        # "send for eSign after stamp"), esign_service.initiate_esign
        # downgrades this back to 'Partially Completed' moments later, and the
        # signer-completion rollup re-completes it (and generates the
        # invoice) once eSign actually finishes. A retry landing here with an
        # eSign already attached and signed also completes correctly, since
        # the guard only checks "no eSign yet OR already signed".
        with get_transaction() as connection:
            existing_esign = connection.execute(
                "SELECT status FROM b2b_esign_transaction WHERE order_id = %s", (order_id,)
            ).fetchone()
            if not existing_esign or existing_esign["status"] == "signed":
                connection.execute(
                    "UPDATE orders SET status = 'Completed', updated_at = now() WHERE id = %s AND service_name = 'eStamp' AND status != 'Completed'",
                    (order_id,),
                )
        # Never raises — see its own docstring; a failure there just leaves
        # the invoice to generate lazily on first manual download instead.
        _auto_generate_invoice_on_completion(order_id)

    return {
        "status": status,
        "reference_id": reference_id,
        "transaction_id": response.get("transaction_id"),
        "stamp_paper_number": response.get("stamp_paper_number"),
        "stamp_duty_amount": response.get("stamp_duty_amount"),
        "message": response.get("message"),
    }


def get_stamp_status(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_stamp(connection, order_id, organization_id)
        transaction = connection.execute(
            """
            SELECT status, reference_id, signdesk_transaction_id, stamp_paper_number, stamp_duty_amount,
                   error_message, stamped_file_path, created_at, updated_at
            FROM b2b_stamp_transaction WHERE order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not transaction:
            raise HTTPException(status_code=404, detail="No eStamp request has been sent for this order yet")
    return transaction


def get_stamped_file_path(*, order_id: UUID, organization_id: UUID) -> Path:
    with get_connection() as connection:
        _get_order_for_stamp(connection, order_id, organization_id)
        transaction = connection.execute(
            "SELECT stamped_file_path FROM b2b_stamp_transaction WHERE order_id = %s",
            (order_id,),
        ).fetchone()

    if not transaction or not transaction["stamped_file_path"]:
        raise HTTPException(status_code=404, detail="Stamped document is not available yet")

    path = STAMPED_UPLOAD_DIR / transaction["stamped_file_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stamped document file is missing on server")

    try:
        with open(path, "rb") as f:
            header = f.read(5)
    except OSError:
        logger.exception("Failed to read stamped PDF for order %s at %s", order_id, path)
        raise HTTPException(status_code=404, detail="Stamped document could not be read")

    if not _is_valid_pdf_bytes(header):
        logger.error("Stamped PDF for order %s at %s failed validation on read — treating as unavailable.", order_id, path)
        raise HTTPException(status_code=404, detail="Stamped document appears to be corrupted")

    return path


def initiate_stamp_otf(*, order_id: UUID, organization_id: UUID, body: StampOtfInitiateRequest) -> dict[str, Any]:
    """"eStamp On The Fly" (Karnataka) equivalent of initiate_stamp above —
    same wallet-block / SignDesk-call / debit-or-release / upsert / notify /
    invoice-trigger sequence, reusing every one of initiate_stamp's helpers.
    Structurally a close copy rather than a shared function because the two
    services must never silently interact (see _get_order_for_stamp_otf) and
    their payload/validation shapes have already diverged (no stamp_state
    choice, no surcharge, a mandatory article code) — see the module-level
    docstring-equivalent comments on StampOtfInitiateRequest and
    _build_request_payload_otf for why."""
    if body.stamp_state in SHCIL_OTF_STATES:
        article = resolve_article(body.stamp_state, body.digital_article_code)
        stamp_state_code = SHCIL_STATE_CODES[body.stamp_state]
        article_number = article["article_number"]
        digital_article_code = body.digital_article_code
        document_category_value = article["document_category"]
    else:
        stamp_state_code = "MH"
        article_number = None
        digital_article_code = None
        document_category_value = body.document_category

    with get_connection() as connection:
        order = _get_order_for_stamp_otf(connection, order_id, organization_id)

    charge_wallet = (order["payment_mode"] or "Wallet") != "PPS" and not order["stamp_value_wallet_debited"]

    pdf_path = ORDER_UPLOAD_DIR / order["document_path"]
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded document not found on server")
    pdf_bytes = pdf_path.read_bytes()

    order_id_str = str(order_id)
    reference_id = new_reference_id(order_id_str)
    payload = _build_request_payload_otf(body)

    if charge_wallet:
        with get_transaction() as connection:
            _block_wallet_amount(
                connection,
                organization_id=organization_id, organization_user_id=order["organization_user_id"],
                amount=body.stamp_amount, order_id=order_id,
                description=f"eStamp On The Fly order {order_id} · Stamp Value (blocked)",
            )

    try:
        response = request_stamp_paper_otf(
            reference_id=reference_id,
            content_b64=base64.b64encode(pdf_bytes).decode("ascii"),
            payload=payload,
        )
        if response.get("status") != "success":
            raise SignDeskStampError(
                response.get("message") or f"SignDesk stamp request failed: {response}",
                error_code=response.get("error_code"), raw_response=response,
            )
    except SignDeskStampError as e:
        if charge_wallet:
            with get_transaction() as connection:
                _release_wallet_block(
                    connection,
                    organization_id=organization_id, organization_user_id=order["organization_user_id"],
                    amount=body.stamp_amount, order_id=order_id,
                )
        _upsert_transaction(
            order_id=order_id, reference_id=reference_id, stamp_state=stamp_state_code,
            document_category=document_category_value, stamp_amount=body.stamp_amount,
            consideration_amount=body.consideration_amount, status="failed",
            error_message=str(e), error_code=e.error_code, raw_response=e.raw_response or {"error": str(e)},
            article_number=article_number, digital_article_code=digital_article_code,
        )
        with get_transaction() as connection:
            connection.execute(
                "UPDATE orders SET status = 'Failed', updated_at = now() WHERE id = %s",
                (order_id,),
            )
        notify_estamp_status(
            organization_id=organization_id, organization_user_id=order["organization_user_id"],
            order_id=order_id, order_no=order["order_no"], status="Failed",
        )
        raise HTTPException(status_code=502, detail=_signdesk_error_detail(e)) from e

    if charge_wallet:
        _debit_stamp_value(
            order_id=order_id, organization_id=organization_id, organization_user_id=order["organization_user_id"],
            amount=body.stamp_amount, order_id_str=order_id_str,
        )

    stamped_content = response.get("content")
    stamped_file_path = None
    status = "processing"
    if stamped_content:
        stamped_file_path = _save_stamped_pdf(order_id=order_id, content_b64=stamped_content)
        status = "completed"

    _upsert_transaction(
        order_id=order_id, reference_id=reference_id, stamp_state=stamp_state_code,
        document_category=document_category_value, stamp_amount=body.stamp_amount,
        consideration_amount=body.consideration_amount, status=status,
        signdesk_transaction_id=response.get("transaction_id"), signdesk_order_id=response.get("order_id"),
        stamp_paper_number=str(response.get("stamp_paper_number")) if response.get("stamp_paper_number") else None,
        stamp_duty_amount=response.get("stamp_duty_amount") or None,
        error_code=response.get("error_code"), raw_response=response, stamped_file_path=stamped_file_path,
        article_number=article_number, digital_article_code=digital_article_code,
    )

    if status == "completed":
        notify_estamp_status(
            organization_id=organization_id, organization_user_id=order["organization_user_id"],
            order_id=order_id, order_no=order["order_no"], status="Completed",
        )
        # No "send for eSign after stamp" chaining for this service (v1
        # scope) — unlike initiate_stamp, there's no attached-eSign case to
        # guard against, so this can complete unconditionally.
        with get_transaction() as connection:
            connection.execute(
                "UPDATE orders SET status = 'Completed', updated_at = now() WHERE id = %s AND service_name = %s AND status != 'Completed'",
                (order_id, OTF_SERVICE_NAME),
            )
        _auto_generate_invoice_on_completion(order_id)

    return {
        "status": status,
        "reference_id": reference_id,
        "transaction_id": response.get("transaction_id"),
        "stamp_paper_number": response.get("stamp_paper_number"),
        "stamp_duty_amount": response.get("stamp_duty_amount"),
        "message": response.get("message"),
    }


def get_stamp_otf_status(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_stamp_otf(connection, order_id, organization_id)
        transaction = connection.execute(
            """
            SELECT status, reference_id, signdesk_transaction_id, stamp_paper_number, stamp_duty_amount,
                   error_message, stamped_file_path, article_number, digital_article_code, created_at, updated_at
            FROM b2b_stamp_transaction WHERE order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not transaction:
            raise HTTPException(status_code=404, detail="No eStamp On The Fly request has been sent for this order yet")
    return transaction


def get_stamp_otf_file_path(*, order_id: UUID, organization_id: UUID) -> Path:
    with get_connection() as connection:
        _get_order_for_stamp_otf(connection, order_id, organization_id)
        transaction = connection.execute(
            "SELECT stamped_file_path FROM b2b_stamp_transaction WHERE order_id = %s",
            (order_id,),
        ).fetchone()

    if not transaction or not transaction["stamped_file_path"]:
        raise HTTPException(status_code=404, detail="Stamped document is not available yet")

    path = STAMPED_UPLOAD_DIR / transaction["stamped_file_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stamped document file is missing on server")

    try:
        with open(path, "rb") as f:
            header = f.read(5)
    except OSError:
        logger.exception("Failed to read stamped PDF for order %s at %s", order_id, path)
        raise HTTPException(status_code=404, detail="Stamped document could not be read")

    if not _is_valid_pdf_bytes(header):
        logger.error("Stamped PDF for order %s at %s failed validation on read — treating as unavailable.", order_id, path)
        raise HTTPException(status_code=404, detail="Stamped document appears to be corrupted")

    return path
