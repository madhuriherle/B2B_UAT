import logging
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.database import get_connection, get_transaction
from app.notification_service import notify_ekyc_result
from app.signdesk_ekyc import SignDeskError, new_reference_id, verify_document

logger = logging.getLogger(__name__)

ORDER_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "orders"

# Must match the doc_type dropdown in PartnerUserCreateOrder.jsx and the
# values SignDesk's General Document Verification API accepts.
VALID_DOC_TYPES = {"aadhaar_card", "pan_card", "passport", "driving_licence", "voter_card"}


def _get_order_for_ekyc(connection, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    order = connection.execute(
        """
        SELECT id, service_name, document_type, document_filename, document_path
        FROM orders
        WHERE id = %s AND organization_id = %s
        """,
        (order_id, organization_id),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["service_name"] != "eKYC":
        raise HTTPException(status_code=400, detail="This order is not an eKYC order")
    if not order["document_path"]:
        raise HTTPException(status_code=400, detail="Order has no document to verify")
    if not order["document_type"] or order["document_type"] not in VALID_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Order has no valid document type set")
    return order


def _sync_ekyc_order_status(connection, order_id: UUID) -> None:
    """Keeps orders.status honest for eKYC orders — see esign_service's
    analogous 'Completed' write for the established precedent of a service
    updating orders.status once its async outcome is known. Re-run after
    every b2b_ekyc_verification/b2b_digilocker_verification write (both
    services call this) so a later DigiLocker success can still upgrade an
    order that initially failed or was left pending.

    Deliberately never writes 'Completed'/'Success' for an extraction-only
    result — that would overclaim government verification. 'Document
    Extracted' is the terminal state for doc types with no verification path
    (e.g. Passport); 'Verified' is reserved for an actual confirmed
    government check (direct or via DigiLocker).
    """
    ekyc = connection.execute(
        "SELECT status, verified, doc_type FROM b2b_ekyc_verification WHERE order_id = %s",
        (order_id,),
    ).fetchone()
    if not ekyc:
        return
    order = connection.execute(
        "SELECT status, organization_id, organization_user_id, order_no FROM orders WHERE id = %s AND service_name = 'eKYC'",
        (order_id,),
    ).fetchone()
    if not order:
        return
    digilocker = connection.execute(
        "SELECT status FROM b2b_digilocker_verification WHERE order_id = %s",
        (order_id,),
    ).fetchone()
    pan = connection.execute(
        "SELECT status, valid_pan FROM b2b_pan_verification WHERE order_id = %s",
        (order_id,),
    ).fetchone()

    if (
        ekyc["verified"]
        or (digilocker and digilocker["status"] == "verified")
        or (pan and pan["status"] == "verified" and pan["valid_pan"])
    ):
        new_status = "Verified"
    elif ekyc["status"] == "failed" and not (digilocker and digilocker["status"] == "verified"):
        new_status = "Failed"
    elif digilocker and digilocker["status"] == "link_generated":
        new_status = "Verification Pending"
    elif ekyc["doc_type"] == "aadhaar_card":
        new_status = "Verification Pending"
    else:
        new_status = "Document Extracted"

    connection.execute(
        "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s AND service_name = 'eKYC'",
        (new_status, order_id),
    )

    # Only notify on a genuine change into a terminal outcome —
    # "Verification Pending" stays silent (matches the terminal-only
    # decision for order-status notifications elsewhere), and re-runs of
    # this function that land on the same status again (it's called after
    # every eKYC/DigiLocker/PAN write) must not re-fire.
    if new_status != order["status"] and new_status in ("Verified", "Failed", "Document Extracted"):
        notify_ekyc_result(
            organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
            order_id=order_id, order_no=order["order_no"], status=new_status,
        )


def _auto_invoice_ekyc_on_verification(order_id: UUID) -> None:
    """Automatically debits the wallet and generates the invoice the moment
    eKYC verification lands on a real outcome — 'Verified' (DigiLocker or
    PAN) or 'Document Extracted' (terminal state for doc types with no
    verification path, e.g. Passport) — no Super Admin click required.
    Explicit product decision: unlike Document Service/eNotary/eSBTR (which
    have no equivalent externally-confirmed completion signal and still
    need a manual Generate Invoice), DigiLocker/PAN verification is itself
    an external, tamper-proof confirmation — same reasoning eStamp Bulk's
    Completed-triggered auto-charge already relies on — so it's safe to
    charge automatically here too, same as the real SignDesk eSign webhook
    now does (see esign_service.record_callback's charge_wallet=True).

    Reuses the same universal get_or_create_invoice_for_order(charge_wallet=
    True) mechanism every other auto-invoice hook uses — service_charge_
    wallet_debited still guards against double-charging if more than one
    verification path (DigiLocker, PAN, the initial extraction call) lands
    on the same terminal status for the same order. Never raises — called
    from inside a partner user's own verification request, and a billing
    hiccup must never make a real, successful verification look like it
    failed to them; worst case the fee stays uncharged until Super Admin
    generates it manually.
    """
    from app.invoice_service import get_or_create_invoice_for_order

    with get_connection() as connection:
        order = connection.execute(
            "SELECT organization_id, organization_user_id, status FROM orders WHERE id = %s AND service_name = 'eKYC'",
            (order_id,),
        ).fetchone()
    if not order or order["status"] not in ("Verified", "Document Extracted"):
        return

    try:
        get_or_create_invoice_for_order(
            order_id=order_id, organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
            charge_wallet=True,
        )
    except Exception:
        logger.exception("Auto invoice/charge failed for eKYC order %s after verification", order_id)


def initiate_ekyc(*, order_id: UUID, organization_id: UUID, verification: bool = True) -> dict[str, Any]:
    with get_connection() as connection:
        order = _get_order_for_ekyc(connection, order_id, organization_id)
        existing = connection.execute(
            "SELECT status FROM b2b_ekyc_verification WHERE order_id = %s",
            (order_id,),
        ).fetchone()
    if existing and existing["status"] != "failed":
        raise HTTPException(status_code=400, detail="This order has already been submitted for eKYC verification")

    doc_path = ORDER_UPLOAD_DIR / order["document_path"]
    if not doc_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded document not found on server")
    doc_bytes = doc_path.read_bytes()

    doc_type = order["document_type"]
    reference_id = new_reference_id(str(order_id))

    try:
        response = verify_document(
            reference_id=reference_id,
            doc_bytes=doc_bytes,
            doc_type=doc_type,
            verification=verification,
        )
    except SignDeskError as e:
        with get_transaction() as connection:
            connection.execute(
                """
                INSERT INTO b2b_ekyc_verification (
                    order_id, reference_id, doc_type, verification_requested, status, error, raw_response, updated_at
                )
                VALUES (%s, %s, %s, %s, 'failed', %s, %s, now())
                ON CONFLICT (order_id) DO UPDATE SET
                    reference_id = EXCLUDED.reference_id, doc_type = EXCLUDED.doc_type,
                    verification_requested = EXCLUDED.verification_requested, status = 'failed',
                    error = EXCLUDED.error, raw_response = EXCLUDED.raw_response, updated_at = now()
                """,
                (order_id, reference_id, doc_type, verification, str(e), Jsonb({"error": str(e)})),
            )
            _sync_ekyc_order_status(connection, order_id)
        raise HTTPException(status_code=502, detail=str(e)) from e

    status = "success" if response.get("status") == "success" else "failed"
    verified = response.get("verified")
    extracted_data = response.get("extracted_data")
    error = response.get("error")
    error_code = response.get("error_code")

    with get_transaction() as connection:
        row = connection.execute(
            """
            INSERT INTO b2b_ekyc_verification (
                order_id, reference_id, doc_type, verification_requested, status, verified,
                extracted_data, raw_response, error, error_code, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (order_id) DO UPDATE SET
                reference_id = EXCLUDED.reference_id, doc_type = EXCLUDED.doc_type,
                verification_requested = EXCLUDED.verification_requested, status = EXCLUDED.status,
                verified = EXCLUDED.verified, extracted_data = EXCLUDED.extracted_data,
                raw_response = EXCLUDED.raw_response, error = EXCLUDED.error, error_code = EXCLUDED.error_code,
                updated_at = now()
            RETURNING id, order_id, reference_id, doc_type, status, verified, extracted_data,
                error, error_code, created_at, updated_at
            """,
            (
                order_id, reference_id, doc_type, verification, status, verified,
                Jsonb(extracted_data) if extracted_data is not None else None, Jsonb(response), error, error_code,
            ),
        ).fetchone()
        _sync_ekyc_order_status(connection, order_id)

    _auto_invoice_ekyc_on_verification(order_id)
    return row


def get_ekyc_status(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_ekyc(connection, order_id, organization_id)
        row = connection.execute(
            """
            SELECT id, order_id, reference_id, doc_type, status, verified, extracted_data,
                error, error_code, created_at, updated_at
            FROM b2b_ekyc_verification WHERE order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No eKYC verification has been submitted for this order yet")
    return row
