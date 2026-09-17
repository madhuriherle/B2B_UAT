import base64
import binascii
from typing import Any

from app import signdesk_ekyc, signdesk_esign, signdesk_stamp
from app.email_service import send_esign_invitation_email
from app.services.providers.base import ProviderResult

# All HTTP transport (credentials, endpoint, request/response parsing) stays
# in the existing app/signdesk_*.py modules — the same ones the B2C/B2B admin
# flows already call — so there's exactly one implementation of each SignDesk
# integration. This module only adapts the /api/v1 request shape to what
# those functions expect and normalizes the result to ProviderResult.


def _decode_base64(value: str) -> bytes | None:
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None


def initiate_esign(
    *,
    request_id: str,
    document_name: str,
    email: str,
    document_base64: str,
    signer_name: str,
    signer_mobile: str,
) -> ProviderResult:
    from app.validators import validate_safe_pdf_bytes

    pdf_bytes = _decode_base64(document_base64)
    if pdf_bytes is None:
        return ProviderResult(
            success=False, http_status=400, provider_reference_id=None,
            response_payload={}, error_message="document_base64 is not valid base64",
        )
    try:
        validate_safe_pdf_bytes(pdf_bytes)
    except ValueError as e:
        return ProviderResult(
            success=False, http_status=400, provider_reference_id=None,
            response_payload={}, error_message=str(e),
        )

    reference_id = signdesk_esign.new_reference_id(request_id)
    document_reference_id = signdesk_esign.new_document_reference_id(request_id)

    try:
        response = signdesk_esign.send_sign_request(
            reference_id=reference_id,
            docket_title=document_name,
            pdf_bytes=pdf_bytes,
            document_reference_id=document_reference_id,
            signers=[
                {
                    "ref_id": signdesk_esign.new_signer_ref_id(request_id, 1),
                    "name": signer_name,
                    "email": email,
                    "mobile": signer_mobile,
                    "sequence": 1,
                }
            ],
            # So SignDesk's completion webhook lands on this gateway's own
            # handler (app/routes/api_v1_webhooks.py), not the legacy B2C/B2B
            # admin one — that one looks up b2b_esign_transaction, which has
            # no row for a docket created through /api/v1.
            callback_path="/api/v1/webhooks/signdesk/esign",
        )
    except signdesk_esign.SignDeskError as e:
        return ProviderResult(
            success=False, http_status=502, provider_reference_id=reference_id,
            response_payload={}, error_message=str(e),
        )

    success = response.get("status") == "success"
    if success:
        # Melento no longer sends invitation email (see signdesk_esign) —
        # deliver LegalDesk-branded invite when the API client provided an
        # email and SignDesk returned an invitation_link.
        for info in response.get("signer_info") or []:
            if not isinstance(info, dict):
                continue
            link = info.get("invitation_link")
            if not email or not link:
                continue
            try:
                send_esign_invitation_email(
                    to_email=email,
                    signer_name=signer_name,
                    inviter_name="LegalDesk",
                    document_name=document_name,
                    invitation_link=link,
                )
            except Exception:
                # Don't fail the API call after SignDesk already created the
                # docket — the signing link is still in response_payload.
                pass

    return ProviderResult(
        success=success,
        http_status=200,
        provider_reference_id=response.get("docket_id") or reference_id,
        response_payload=response,
        error_message=None if success else (response.get("message") or "SignDesk did not return a success status"),
    )


def create_estamp(*, request_id: str, payload: dict[str, Any]) -> ProviderResult:
    content_b64 = payload.get("content_base64")
    if not content_b64 or _decode_base64(content_b64) is None:
        return ProviderResult(
            success=False, http_status=400, provider_reference_id=None,
            response_payload={}, error_message="content_base64 is required and must be valid base64",
        )

    reference_id = signdesk_stamp.new_reference_id(request_id)
    extra_payload = {k: v for k, v in payload.items() if k not in ("content_base64", "reference_id")}

    try:
        response = signdesk_stamp.request_stamp_paper(
            reference_id=reference_id, content_b64=content_b64, payload=extra_payload,
        )
    except signdesk_stamp.SignDeskStampError as e:
        return ProviderResult(
            success=False, http_status=502, provider_reference_id=reference_id,
            response_payload={}, error_message=str(e),
        )

    success = response.get("status") == "success"
    return ProviderResult(
        success=success,
        http_status=200,
        provider_reference_id=response.get("transaction_id") or reference_id,
        response_payload=response,
        error_message=None if success else (response.get("message") or "SignDesk did not return a success status"),
    )


def revoke_esign(*, docket_id: str, document_id: str) -> ProviderResult:
    try:
        response = signdesk_esign.revoke_document(document_id=document_id, docket_id=docket_id)
    except signdesk_esign.SignDeskError as e:
        return ProviderResult(
            success=False, http_status=502, provider_reference_id=docket_id,
            response_payload={}, error_message=str(e),
        )

    success = response.get("status") == "success"
    return ProviderResult(
        success=success,
        http_status=200,
        provider_reference_id=docket_id,
        response_payload=response,
        error_message=None if success else (response.get("message") or "SignDesk did not confirm the revoke"),
    )


def verify_ekyc(*, request_id: str, payload: dict[str, Any]) -> ProviderResult:
    doc_type = payload.get("doc_type")
    document_base64 = payload.get("document_base64")
    doc_bytes = _decode_base64(document_base64) if document_base64 else None
    if not doc_type or doc_bytes is None:
        return ProviderResult(
            success=False, http_status=400, provider_reference_id=None,
            response_payload={}, error_message="doc_type and a valid base64 document_base64 are required",
        )

    reference_id = signdesk_ekyc.new_reference_id(request_id)

    try:
        response = signdesk_ekyc.verify_document(
            reference_id=reference_id,
            doc_bytes=doc_bytes,
            doc_type=doc_type,
            verification=bool(payload.get("verification", True)),
        )
    except signdesk_ekyc.SignDeskError as e:
        return ProviderResult(
            success=False, http_status=502, provider_reference_id=reference_id,
            response_payload={}, error_message=str(e),
        )

    success = response.get("status") == "success"
    return ProviderResult(
        success=success,
        http_status=200,
        provider_reference_id=reference_id,
        response_payload=response,
        error_message=None if success else (response.get("error") or "SignDesk did not return a success status"),
    )
