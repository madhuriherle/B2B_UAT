import base64
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.database import get_connection, get_transaction
from app.ekyc_service import ORDER_UPLOAD_DIR, _auto_invoice_ekyc_on_verification, _sync_ekyc_order_status
from app.signdesk_pan import SignDeskError, new_reference_id, verify_pan


def _get_order_for_pan(connection, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    order = connection.execute(
        """
        SELECT id, service_name, document_type, document_path
        FROM orders
        WHERE id = %s AND organization_id = %s
        """,
        (order_id, organization_id),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["service_name"] != "eKYC" or order["document_type"] != "pan_card":
        raise HTTPException(status_code=400, detail="This order is not a PAN card eKYC order")
    if not order["document_path"]:
        raise HTTPException(status_code=400, detail="Order has no document to verify")
    return order


def initiate_pan_verification(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        order = _get_order_for_pan(connection, order_id, organization_id)
        existing = connection.execute(
            "SELECT status FROM b2b_pan_verification WHERE order_id = %s",
            (order_id,),
        ).fetchone()
    if existing and existing["status"] != "failed":
        raise HTTPException(status_code=400, detail="This order has already been submitted for PAN verification")

    doc_path = ORDER_UPLOAD_DIR / order["document_path"]
    if not doc_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded document not found on server")
    source = base64.b64encode(doc_path.read_bytes()).decode("ascii")

    reference_id = new_reference_id(str(order_id))

    try:
        response = verify_pan(reference_id=reference_id, source_type="base64", source=source)
    except SignDeskError as e:
        with get_transaction() as connection:
            connection.execute(
                """
                INSERT INTO b2b_pan_verification (order_id, reference_id, status, error, raw_response, updated_at)
                VALUES (%s, %s, 'failed', %s, %s, now())
                ON CONFLICT (order_id) DO UPDATE SET
                    reference_id = EXCLUDED.reference_id, status = 'failed',
                    error = EXCLUDED.error, raw_response = EXCLUDED.raw_response, updated_at = now()
                """,
                (order_id, reference_id, str(e), Jsonb({"error": str(e)})),
            )
            _sync_ekyc_order_status(connection, order_id)
        raise HTTPException(status_code=502, detail=str(e)) from e

    status = "verified" if response.get("status") == "success" else "failed"
    result = response.get("result") or {}
    transaction_id = response.get("transaction_id")
    valid_pan = result.get("valid_pan")
    extracted_data = result.get("extracted_data")
    validated_data = result.get("validated_data")
    data_match = result.get("data_match")
    data_match_aggregate = result.get("data_match_aggregate")
    error = response.get("error")
    error_code = response.get("error_code")

    with get_transaction() as connection:
        row = connection.execute(
            """
            INSERT INTO b2b_pan_verification (
                order_id, reference_id, transaction_id, status, valid_pan,
                extracted_data, validated_data, data_match, data_match_aggregate,
                raw_response, error, error_code, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (order_id) DO UPDATE SET
                reference_id = EXCLUDED.reference_id, transaction_id = EXCLUDED.transaction_id,
                status = EXCLUDED.status, valid_pan = EXCLUDED.valid_pan,
                extracted_data = EXCLUDED.extracted_data, validated_data = EXCLUDED.validated_data,
                data_match = EXCLUDED.data_match, data_match_aggregate = EXCLUDED.data_match_aggregate,
                raw_response = EXCLUDED.raw_response, error = EXCLUDED.error, error_code = EXCLUDED.error_code,
                updated_at = now()
            RETURNING id, order_id, reference_id, transaction_id, status, valid_pan,
                extracted_data, validated_data, data_match, data_match_aggregate,
                error, error_code, created_at, updated_at
            """,
            (
                order_id, reference_id, transaction_id, status, valid_pan,
                Jsonb(extracted_data) if extracted_data is not None else None,
                Jsonb(validated_data) if validated_data is not None else None,
                Jsonb(data_match) if data_match is not None else None,
                data_match_aggregate, Jsonb(response), error, error_code,
            ),
        ).fetchone()
        _sync_ekyc_order_status(connection, order_id)

    _auto_invoice_ekyc_on_verification(order_id)
    return row


def get_pan_status(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_pan(connection, order_id, organization_id)
        row = connection.execute(
            """
            SELECT id, order_id, reference_id, transaction_id, status, valid_pan,
                extracted_data, validated_data, data_match, data_match_aggregate,
                error, error_code, created_at, updated_at
            FROM b2b_pan_verification WHERE order_id = %s
            """,
            (order_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No PAN verification has been submitted for this order yet")
    return row
