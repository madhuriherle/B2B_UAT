from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, EmailStr, field_validator

from app.api_v1_auth import require_service, validate_api_credentials
from app.database import get_connection
from app.services.providers import signdesk as signdesk_provider
from app.services.providers.base import ProviderResult
from app.validators import validate_indian_mobile

router = APIRouter(dependencies=[Depends(validate_api_credentials)])


# Writes the transaction row (status='pending') before any provider call so
# every request is auditable even if that call times out.
def _record_pending_transaction(request: Request, service: str, payload: dict[str, Any]) -> str:
    api_client = request.state.api_client
    customer_reference_id = payload.get("reference_id")

    with get_connection() as connection:
        seq = connection.execute("SELECT nextval('api_request_id_seq') AS n").fetchone()
        request_id = f"REQ{seq['n']:06d}"
        connection.execute(
            """
            INSERT INTO api_transactions (
                request_id, api_client_id, service, customer_reference_id, status, request_payload
            )
            VALUES (%s, %s, %s, %s, 'pending', %s)
            """,
            (request_id, api_client.id, service, customer_reference_id, Jsonb(payload)),
        )

    return request_id


def _finalize_transaction(request_id: str, result: ProviderResult) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE api_transactions
            SET status = %s, provider_reference_id = %s, response_payload = %s,
                error_message = %s, updated_at = now()
            WHERE request_id = %s
            """,
            (
                "success" if result.success else "failed",
                result.provider_reference_id,
                Jsonb(result.response_payload),
                result.error_message,
                request_id,
            ),
        )


def _finalize_revoke(request_id: str, existing_payload: dict[str, Any], result: ProviderResult) -> None:
    merged_payload = {**existing_payload, "revoke_response": result.response_payload or {"error": result.error_message}}
    with get_connection() as connection:
        if result.success:
            connection.execute(
                "UPDATE api_transactions SET status = 'revoked', response_payload = %s, updated_at = now() WHERE request_id = %s",
                (Jsonb(merged_payload), request_id),
            )
        else:
            # A failed revoke ATTEMPT must not touch the underlying
            # transaction's own status/error_message — the original eSign
            # request is still exactly as valid as it was; only this attempt
            # is recorded (under response_payload.revoke_response) so a
            # client can see it was tried.
            connection.execute(
                "UPDATE api_transactions SET response_payload = %s, updated_at = now() WHERE request_id = %s",
                (Jsonb(merged_payload), request_id),
            )


# A provider function never raises (its own known SignDesk errors already
# become a failed ProviderResult) — this is only the last line of defense so
# a genuinely unexpected exception still resolves to a result object instead
# of an unhandled exception, which would otherwise leave the transaction
# stuck in "pending" forever.
def _safe_call(call) -> ProviderResult:
    try:
        return call()
    except Exception as e:
        return ProviderResult(
            success=False, http_status=502, provider_reference_id=None,
            response_payload={}, error_message=f"Unexpected error calling provider: {e}",
        )


def _provider_response(request_id: str, result: ProviderResult) -> JSONResponse:
    body = {**result.response_payload, "request_id": request_id, "success": result.success}
    if not result.success:
        body.setdefault("message", result.error_message or "Request failed")
    return JSONResponse(status_code=result.http_status, content=body)


# Router responsibility ends at "call the provider, update the transaction,
# return its response" — shared by the three initiate/create/verify
# endpoints so none of them duplicate it.
def _call_provider(request_id: str, call) -> JSONResponse:
    result = _safe_call(call)
    _finalize_transaction(request_id, result)
    return _provider_response(request_id, result)


# Scopes every status/download/revoke lookup to the calling client — a
# client can only ever see or act on its own transactions, never another
# client's, even if it somehow guesses a valid request_id.
def _get_owned_transaction(request: Request, request_id: str, service: str) -> dict[str, Any] | None:
    api_client = request.state.api_client
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT request_id, service, status, provider_reference_id, customer_reference_id,
                   response_payload, error_message, created_at, updated_at
            FROM api_transactions
            WHERE request_id = %s AND api_client_id = %s AND service = %s
            """,
            (request_id, api_client.id, service),
        ).fetchone()


def _not_found(request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"success": False, "request_id": request_id, "message": "Transaction not found"},
    )


def _status_response(txn: dict[str, Any]) -> dict[str, Any]:
    return {
        "success": True,
        "request_id": txn["request_id"],
        "status": txn["status"],
        "provider_reference_id": txn["provider_reference_id"],
        "customer_reference_id": txn["customer_reference_id"],
        "provider_response": txn["response_payload"],
        "error_message": txn["error_message"],
        "created_at": txn["created_at"],
        "updated_at": txn["updated_at"],
    }


class EsignInitiateRequest(BaseModel):
    document_name: str
    email: EmailStr
    document_base64: str
    signer_name: str
    signer_mobile: str
    reference_id: str | None = None

    _validate_mobile = field_validator("signer_mobile")(validate_indian_mobile)


@router.post("/esign/initiate", dependencies=[Depends(require_service("esign"))])
def esign_initiate(payload: EsignInitiateRequest, request: Request) -> Any:
    request_id = _record_pending_transaction(request, "eSign", payload.model_dump())
    return _call_provider(
        request_id,
        lambda: signdesk_provider.initiate_esign(
            request_id=request_id,
            document_name=payload.document_name,
            email=payload.email,
            document_base64=payload.document_base64,
            signer_name=payload.signer_name,
            signer_mobile=payload.signer_mobile,
        ),
    )


@router.get("/esign/status/{request_id}", dependencies=[Depends(require_service("esign"))])
def esign_status(request_id: str, request: Request) -> Any:
    txn = _get_owned_transaction(request, request_id, "eSign")
    if not txn:
        return _not_found(request_id)
    return _status_response(txn)


# SignDesk never exposes a separate "download signed document" call — the
# signed PDF only ever arrives as base64 content inside the completion
# webhook (see esign_service._save_signed_pdf). Until that webhook is wired
# up here, response_payload has no signed_document_base64 key yet, so this
# always reports "not available" — the endpoint exists now so the API
# surface is complete; the webhook step is what gives it real data.
@router.get("/esign/download/{request_id}", dependencies=[Depends(require_service("esign"))])
def esign_download(request_id: str, request: Request) -> Any:
    txn = _get_owned_transaction(request, request_id, "eSign")
    if not txn:
        return _not_found(request_id)

    content_b64 = (txn["response_payload"] or {}).get("signed_document_base64")
    if not content_b64:
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "request_id": request_id,
                "status": txn["status"],
                "message": "Signed document is not available yet — it is delivered once signing completes.",
            },
        )
    return {"success": True, "request_id": request_id, "content_base64": content_b64, "content_type": "application/pdf"}


@router.post("/esign/revoke/{request_id}", dependencies=[Depends(require_service("esign"))])
def esign_revoke(request_id: str, request: Request) -> Any:
    txn = _get_owned_transaction(request, request_id, "eSign")
    if not txn:
        return _not_found(request_id)
    if txn["status"] != "success":
        return JSONResponse(
            status_code=400,
            content={
                "success": False, "request_id": request_id,
                "message": f"Cannot revoke a transaction with status '{txn['status']}'",
            },
        )

    response_payload = txn["response_payload"] or {}
    docket_id = response_payload.get("docket_id")
    document_id = response_payload.get("document_id")
    if not docket_id or not document_id:
        return JSONResponse(
            status_code=409,
            content={
                "success": False, "request_id": request_id,
                "message": "This transaction has no docket/document reference to revoke.",
            },
        )

    result = _safe_call(lambda: signdesk_provider.revoke_esign(docket_id=docket_id, document_id=document_id))
    _finalize_revoke(request_id, response_payload, result)
    return _provider_response(request_id, result)


# estamp/create and ekyc/verify have no fixed request schema yet (unlike
# esign/initiate above) — the provider layer reads the specific keys it
# needs straight out of the body and fails cleanly if they're missing.


@router.post("/estamp/create", dependencies=[Depends(require_service("estamp"))])
def estamp_create(request: Request, payload: dict[str, Any] = Body(default_factory=dict)) -> Any:
    request_id = _record_pending_transaction(request, "eStamp", payload)
    return _call_provider(
        request_id,
        lambda: signdesk_provider.create_estamp(request_id=request_id, payload=payload),
    )


@router.get("/estamp/status/{request_id}", dependencies=[Depends(require_service("estamp"))])
def estamp_status(request_id: str, request: Request) -> Any:
    txn = _get_owned_transaction(request, request_id, "eStamp")
    if not txn:
        return _not_found(request_id)
    return _status_response(txn)


# Unlike eSign, SignDesk's DSS stamp API can return the stamped PDF directly
# and synchronously in the create response (see stamp_service._save_stamped_pdf)
# — so this is often available right away, no webhook needed.
@router.get("/estamp/download/{request_id}", dependencies=[Depends(require_service("estamp"))])
def estamp_download(request_id: str, request: Request) -> Any:
    txn = _get_owned_transaction(request, request_id, "eStamp")
    if not txn:
        return _not_found(request_id)

    content_b64 = (txn["response_payload"] or {}).get("content")
    if not content_b64:
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "request_id": request_id,
                "status": txn["status"],
                "message": "Stamped document is not available for this transaction.",
            },
        )
    return {"success": True, "request_id": request_id, "content_base64": content_b64, "content_type": "application/pdf"}


@router.post("/ekyc/verify", dependencies=[Depends(require_service("ekyc"))])
def ekyc_verify(request: Request, payload: dict[str, Any] = Body(default_factory=dict)) -> Any:
    request_id = _record_pending_transaction(request, "eKYC", payload)
    return _call_provider(
        request_id,
        lambda: signdesk_provider.verify_ekyc(request_id=request_id, payload=payload),
    )


# eKYC verification is a one-shot synchronous result, not a document — no
# download or revoke concept applies, only looking the result back up.
@router.get("/ekyc/status/{request_id}", dependencies=[Depends(require_service("ekyc"))])
def ekyc_status(request_id: str, request: Request) -> Any:
    txn = _get_owned_transaction(request, request_id, "eKYC")
    if not txn:
        return _not_found(request_id)
    return _status_response(txn)
