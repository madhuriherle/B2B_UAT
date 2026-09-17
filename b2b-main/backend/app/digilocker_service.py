import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.database import get_connection, get_transaction
from app.ekyc_service import _auto_invoice_ekyc_on_verification, _sync_ekyc_order_status
from app.signdesk_digilocker import SignDeskError, generate_url, get_aadhaar_details, new_reference_id

logger = logging.getLogger(__name__)


def _get_order_for_digilocker(connection, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    order = connection.execute(
        """
        SELECT id, service_name
        FROM orders
        WHERE id = %s AND organization_id = %s
        """,
        (order_id, organization_id),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["service_name"] != "eKYC":
        raise HTTPException(status_code=400, detail="This order is not an eKYC order")
    return order


def initiate_digilocker(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_digilocker(connection, order_id, organization_id)
        existing = connection.execute(
            "SELECT status FROM b2b_digilocker_verification WHERE order_id = %s",
            (order_id,),
        ).fetchone()
    if existing and existing["status"] != "failed":
        raise HTTPException(status_code=400, detail="This order has already been submitted for DigiLocker verification")

    reference_id = new_reference_id(str(order_id))

    try:
        response = generate_url(reference_id=reference_id)
    except SignDeskError as e:
        with get_transaction() as connection:
            connection.execute(
                """
                INSERT INTO b2b_digilocker_verification (
                    order_id, reference_id, status, error, raw_response, updated_at
                )
                VALUES (%s, %s, 'failed', %s, %s, now())
                ON CONFLICT (order_id) DO UPDATE SET
                    reference_id = EXCLUDED.reference_id, status = 'failed',
                    error = EXCLUDED.error, raw_response = EXCLUDED.raw_response, updated_at = now()
                """,
                (order_id, reference_id, str(e), Jsonb({"error": str(e)})),
            )
            _sync_ekyc_order_status(connection, order_id)
        raise HTTPException(status_code=502, detail=str(e)) from e

    status = "link_generated" if response.get("status") == "success" else "failed"
    transaction_id = response.get("transaction_id")
    link = (response.get("result") or {}).get("link")
    error = response.get("error")
    error_code = response.get("error_code")

    with get_transaction() as connection:
        row = connection.execute(
            """
            INSERT INTO b2b_digilocker_verification (
                order_id, reference_id, transaction_id, link, status, raw_response, error, error_code, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (order_id) DO UPDATE SET
                reference_id = EXCLUDED.reference_id, transaction_id = EXCLUDED.transaction_id,
                link = EXCLUDED.link, status = EXCLUDED.status,
                raw_response = EXCLUDED.raw_response, error = EXCLUDED.error, error_code = EXCLUDED.error_code,
                updated_at = now()
            RETURNING id, order_id, reference_id, transaction_id, link, status, error, error_code, created_at, updated_at
            """,
            (order_id, reference_id, transaction_id, link, status, Jsonb(response), error, error_code),
        ).fetchone()
        _sync_ekyc_order_status(connection, order_id)

    _auto_invoice_ekyc_on_verification(order_id)
    return row


def get_digilocker_status(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_digilocker(connection, order_id, organization_id)
        row = connection.execute(
            """
            SELECT id, order_id, reference_id, transaction_id, link, status, error, error_code,
                   aadhaar_data, aadhaar_last4, aadhaar_verified_at, created_at, updated_at
            FROM b2b_digilocker_verification WHERE order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No DigiLocker verification has been initiated for this order yet")
    return row


# UIDAI/CCA compliance (Annexure 2 of SignDesk's eSign API doc): "The Aadhaar
# Number should not be stored." Both fields below can reconstruct or directly
# contain the full Aadhaar number, so neither is ever written to the DB —
# only aadhaar_last4 (derived from uid here, before it's discarded) is kept.
_AADHAAR_NUMBER_FIELDS = ("uid", "xml_file")


def fetch_aadhaar_details(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_digilocker(connection, order_id, organization_id)
        record = connection.execute(
            "SELECT reference_id, transaction_id, status FROM b2b_digilocker_verification WHERE order_id = %s",
            (order_id,),
        ).fetchone()
    if not record:
        raise HTTPException(status_code=404, detail="No DigiLocker verification has been initiated for this order yet")
    if not record["transaction_id"]:
        raise HTTPException(status_code=400, detail="No DigiLocker transaction_id was recorded for this order")
    if record["status"] not in ("link_generated", "failed"):
        raise HTTPException(status_code=400, detail="Aadhaar details have already been fetched for this order")

    try:
        response = get_aadhaar_details(reference_id=record["reference_id"], transaction_id=record["transaction_id"])
    except SignDeskError as e:
        with get_transaction() as connection:
            connection.execute(
                "UPDATE b2b_digilocker_verification SET status = 'failed', error = %s, updated_at = now() WHERE order_id = %s",
                (str(e), order_id),
            )
            _sync_ekyc_order_status(connection, order_id)
        raise HTTPException(status_code=502, detail=str(e)) from e

    uid = response.get("uid") or ""
    aadhaar_last4 = uid[-4:] if len(uid) >= 4 else None
    aadhaar_data = {k: v for k, v in response.items() if k not in _AADHAAR_NUMBER_FIELDS}
    status = "verified" if str(response.get("status", "")).lower() == "success" else "failed"

    with get_transaction() as connection:
        row = connection.execute(
            """
            UPDATE b2b_digilocker_verification
            SET status = %s, aadhaar_data = %s, aadhaar_last4 = %s,
                aadhaar_verified_at = CASE WHEN %s = 'verified' THEN now() ELSE aadhaar_verified_at END,
                raw_response = %s, updated_at = now()
            WHERE order_id = %s
            RETURNING id, order_id, reference_id, transaction_id, link, status,
                aadhaar_data, aadhaar_last4, aadhaar_verified_at, created_at, updated_at
            """,
            (status, Jsonb(aadhaar_data), aadhaar_last4, status, Jsonb(aadhaar_data), order_id),
        ).fetchone()
        _sync_ekyc_order_status(connection, order_id)

    _auto_invoice_ekyc_on_verification(order_id)
    return row


def record_digilocker_callback(payload: dict[str, Any]) -> dict[str, Any]:
    """Processes SignDesk/Melento's real DigiLocker webhook (see their
    "Digilocker API - Webhook" doc) — fired automatically the moment the
    customer completes DigiLocker authentication/consent, carrying the full
    verified result directly (name/dob/gender/address/uid/xml_file), so
    unlike the manual fetch_aadhaar_details path above, this never needs a
    separate follow-up call to get the data.

    Looked up by reference_id (unique per Generate Digilocker URL call, so
    always resolves to exactly one order) — present on both the documented
    success and failure payload shapes, unlike transaction_id which the
    failure shape omits.

    Never raises: a webhook endpoint must always answer with a well-formed
    body, even for a payload we can't make sense of, or SignDesk may retry
    indefinitely against something that will never succeed. Returns
    {"status": "failed", "error_message": ...} only when we genuinely
    couldn't process the callback at all (unknown/missing reference_id);
    a *reported* verification failure (their documented "Failed Case") is
    still something we successfully processed, so that returns
    {"status": "success"} — same "ack receipt vs. report the actual
    business outcome" distinction record_callback's webhook response makes
    for eSign.
    """
    reference_id = payload.get("reference_id")
    if not reference_id:
        logger.error("DigiLocker callback missing reference_id: %r", payload)
        return {"status": "failed", "error_message": "reference_id is required"}

    with get_connection() as connection:
        record = connection.execute(
            "SELECT order_id FROM b2b_digilocker_verification WHERE reference_id = %s",
            (reference_id,),
        ).fetchone()
    if not record:
        logger.error("DigiLocker callback for unknown reference_id %s", reference_id)
        return {"status": "failed", "error_message": "Unknown reference_id"}

    order_id = record["order_id"]
    is_success = str(payload.get("status", "")).lower() == "success"

    if is_success:
        # Documented nesting: result.validated_data.result.{...fields...,
        # uid}, with xml_file as a SIBLING of "result" under validated_data
        # (never inside it) — see the doc's sample payload. UIDAI/CCA
        # compliance: uid/xml_file are never persisted, same rule
        # fetch_aadhaar_details/_AADHAAR_NUMBER_FIELDS already follow —
        # only aadhaar_last4, derived here before uid is discarded, is kept.
        validated = ((payload.get("result") or {}).get("validated_data") or {})
        inner = validated.get("result") or {}
        uid = inner.get("uid") or ""
        aadhaar_last4 = uid[-4:] if len(uid) >= 4 else None
        aadhaar_data = {k: v for k, v in inner.items() if k not in _AADHAAR_NUMBER_FIELDS}

        with get_transaction() as connection:
            connection.execute(
                """
                UPDATE b2b_digilocker_verification
                SET status = 'verified', aadhaar_data = %s, aadhaar_last4 = %s,
                    aadhaar_verified_at = now(), raw_response = %s, updated_at = now()
                WHERE reference_id = %s
                """,
                (Jsonb(aadhaar_data), aadhaar_last4, Jsonb(payload), reference_id),
            )
            _sync_ekyc_order_status(connection, order_id)
        _auto_invoice_ekyc_on_verification(order_id)
    else:
        # Documented failure shape: {status: "", reference_id, error, error_code,
        # response_time_stamp} — see the doc's Error Codes table (dv-265
        # no consent, dv-266 link expired, dv-267 mismatch, etc.).
        error = payload.get("error") or "DigiLocker verification failed"
        error_code = payload.get("error_code")
        with get_transaction() as connection:
            connection.execute(
                """
                UPDATE b2b_digilocker_verification
                SET status = 'failed', error = %s, error_code = %s, raw_response = %s, updated_at = now()
                WHERE reference_id = %s
                """,
                (error, error_code, Jsonb(payload), reference_id),
            )
            _sync_ekyc_order_status(connection, order_id)

    return {"status": "success"}
