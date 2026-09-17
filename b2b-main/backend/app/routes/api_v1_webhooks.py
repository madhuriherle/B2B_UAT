import logging
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import APIRouter, Depends, Request
from psycopg.types.json import Jsonb

from app.api_v1_auth import verify_signdesk_webhook_secret
from app.database import get_connection
from app.routes.esign import _parse_callback_body

logger = logging.getLogger(__name__)

# SignDesk calls these directly — no X-API-ID/X-API-KEY (that's for
# customers calling us). Gated instead by verify_signdesk_webhook_secret.
router = APIRouter(dependencies=[Depends(verify_signdesk_webhook_secret)])


def _get_transaction_by_provider_reference(service: str, provider_reference_id: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT id, request_id, api_client_id, service, status, response_payload
            FROM api_transactions
            WHERE service = %s AND provider_reference_id = %s
            """,
            (service, provider_reference_id),
        ).fetchone()


def _apply_webhook_update(
    transaction: dict[str, Any], *, status: str, error_message: str | None, merge_fields: dict[str, Any]
) -> None:
    merged_payload = {**(transaction["response_payload"] or {}), **merge_fields}
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE api_transactions
            SET status = %s, response_payload = %s, error_message = %s, updated_at = now()
            WHERE id = %s
            """,
            (status, Jsonb(merged_payload), error_message, transaction["id"]),
        )


# Part 5/6 — POSTs the customer's own callback_url (set on their API client,
# see Add API Client) and always logs the attempt, success or failure. Never
# raises: a customer's webhook being down must not affect our response back
# to SignDesk, and a missing callback_url is not an error — it's optional.
def _forward_to_customer(transaction: dict[str, Any], status: str, provider_reference_id: str | None) -> None:
    with get_connection() as connection:
        api_client = connection.execute(
            "SELECT callback_url FROM api_clients WHERE id = %s", (transaction["api_client_id"],)
        ).fetchone()
    callback_url = api_client["callback_url"] if api_client else None
    if not callback_url:
        return

    body = {
        "request_id": transaction["request_id"],
        "status": status,
        "provider_reference_id": provider_reference_id,
    }

    try:
        response = requests.post(callback_url, json=body, timeout=10)
        log_status = "success" if response.ok else "failed"
        response_status = response.status_code
        response_body = response.text[:2000] if response.content else None
    except requests.RequestException as e:
        log_status = "failed"
        response_status = None
        response_body = str(e)[:2000]

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO api_callback_logs (
                transaction_id, callback_url, request_payload, response_status, response_body, status
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (transaction["id"], callback_url, Jsonb(body), response_status, response_body, log_status),
        )


# Anything not in here (including SignDesk's normal completion status) is
# treated as a successful signature — mirrors esign_service.STATUS_MAP, the
# legacy B2C/B2B admin webhook's same mapping.
ESIGN_FAILURE_REASONS: dict[str, str] = {
    "failed": "SignDesk reported the request as failed",
    "cancelled": "SignDesk reported the request as cancelled",
    "declined": "Signer declined to sign the document",
    "rejected": "Signer rejected the document",
    "expired": "The signing link expired before completion",
}


# eSign is the only SignDesk product in this integration with a real async
# completion event (see signdesk_esign.send_sign_request's callback_url and
# esign_service.record_callback, the legacy B2C/B2B admin equivalent this
# mirrors). estamp/ekyc below never actually fire today — both complete
# synchronously in their initial API response (Step 7/8) — but are wired up
# the same way for API-surface completeness, per Step 9's brief.
@router.post("/signdesk/esign")
async def signdesk_esign_webhook(request: Request) -> dict[str, Any]:
    raw_body = await request.body()
    payload = _parse_callback_body(raw_body)

    docket_id = payload.get("docket_id")
    if not docket_id:
        logger.warning("SignDesk eSign webhook missing docket_id — payload: %s", payload)
        return {"status": "failed", "error": {"code": "missing_docket_id", "message": "docket_id is required"}}

    transaction = _get_transaction_by_provider_reference("eSign", docket_id)
    if not transaction:
        # Not an error — could be a docket from the legacy B2C/B2B admin flow
        # hitting the wrong URL, or a replay. Always ACK so SignDesk doesn't
        # retry forever over something we've already looked at and logged.
        logger.warning("SignDesk eSign webhook for unknown docket_id=%s", docket_id)
        return {"status": "success", "data": {"note": "no matching transaction"}}

    signer_entries = payload.get("signer_info")
    if isinstance(signer_entries, dict):
        signer_entries = [signer_entries]
    elif not isinstance(signer_entries, list):
        signer_entries = [{"signer_id": payload["signer_id"]}] if payload.get("signer_id") else []

    raw_status = str(payload.get("status") or "").lower()
    error_message = ESIGN_FAILURE_REASONS.get(raw_status)
    outcome_status = "failed" if error_message else "completed"

    # file_content is the documented field name; content is the legacy
    # return_url redirect's field name — same fallback as esign_service.
    signed_content = payload.get("file_content") or payload.get("content")

    merge_fields: dict[str, Any] = {
        "webhook_payload": payload,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "signers": signer_entries,
    }
    if signed_content:
        merge_fields["signed_document_base64"] = signed_content

    _apply_webhook_update(transaction, status=outcome_status, error_message=error_message, merge_fields=merge_fields)
    _forward_to_customer(transaction, outcome_status, docket_id)

    return {"status": "success", "data": {"document_id": payload.get("document_id"), "docket_id": docket_id}}


async def _generic_webhook(request: Request, service: str) -> dict[str, Any]:
    raw_body = await request.body()
    payload = _parse_callback_body(raw_body)

    provider_reference_id = payload.get("reference_id") or payload.get("transaction_id") or payload.get("docket_id")
    if not provider_reference_id:
        logger.warning("SignDesk %s webhook missing a reference/transaction id — payload: %s", service, payload)
        return {"status": "failed", "error": {"code": "missing_reference", "message": "reference_id is required"}}

    transaction = _get_transaction_by_provider_reference(service, provider_reference_id)
    if not transaction:
        logger.warning("SignDesk %s webhook for unknown reference=%s", service, provider_reference_id)
        return {"status": "success", "data": {"note": "no matching transaction"}}

    raw_status = str(payload.get("status") or "").lower()
    outcome_status = "failed" if raw_status in ("failed", "cancelled", "rejected", "expired", "declined") else "completed"
    error_message = (payload.get("message") or payload.get("error")) if outcome_status == "failed" else None

    merge_fields = {"webhook_payload": payload, "completed_at": datetime.now(timezone.utc).isoformat()}
    _apply_webhook_update(transaction, status=outcome_status, error_message=error_message, merge_fields=merge_fields)
    _forward_to_customer(transaction, outcome_status, provider_reference_id)

    return {"status": "success"}


@router.post("/signdesk/estamp")
async def signdesk_estamp_webhook(request: Request) -> dict[str, Any]:
    return await _generic_webhook(request, "eStamp")


@router.post("/signdesk/ekyc")
async def signdesk_ekyc_webhook(request: Request) -> dict[str, Any]:
    return await _generic_webhook(request, "eKYC")
