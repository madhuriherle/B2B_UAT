import base64
import logging
import os
import uuid
from typing import Any
from urllib.parse import quote

import requests

from app.config import load_backend_env

load_backend_env()

logger = logging.getLogger(__name__)


class SignDeskError(RuntimeError):
    pass


def _config() -> dict[str, str]:
    url = os.getenv("SIGNDESK_ESIGN_URL")
    api_key = os.getenv("SIGNDESK_ESIGN_API_KEY")
    application_id = os.getenv("SIGNDESK_ESIGN_APPLICATION_ID")
    callback_base_url = os.getenv("SIGNDESK_ESIGN_CALLBACK_BASE_URL")
    callback_secret = os.getenv("SIGNDESK_ESIGN_CALLBACK_SECRET")
    if not url or not api_key or not application_id or not callback_base_url or not callback_secret:
        raise SignDeskError(
            "SignDesk eSign is not configured. Set SIGNDESK_ESIGN_URL, SIGNDESK_ESIGN_API_KEY, "
            "SIGNDESK_ESIGN_APPLICATION_ID, SIGNDESK_ESIGN_CALLBACK_BASE_URL and "
            "SIGNDESK_ESIGN_CALLBACK_SECRET in backend/.env."
        )
    return {
        "url": url,
        "api_key": api_key,
        "application_id": application_id,
        "callback_base_url": callback_base_url,
        "callback_secret": callback_secret,
    }


def new_reference_id(order_id: str) -> str:
    return f"legaldesk_esign_{order_id}_{uuid.uuid4().hex[:8]}"


def new_document_reference_id(order_id: str) -> str:
    return f"doc_esign_{order_id}"


def new_signer_ref_id(order_id: str, signer_index: int) -> str:
    return f"signer_esign_{order_id}_{signer_index}"


# When more than one signer signs the same page, SignDesk rejects identical
# signature positions with "The required signer_position is not unique" —
# each signer needs a distinct corner. Cycles through all four corners,
# which covers the UI's 1-4 signer limit (see PartnerUserCreateOrder.jsx)
# without ever repeating a position.
SIGNER_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"]


def send_sign_request(
    *,
    reference_id: str,
    docket_title: str,
    pdf_bytes: bytes,
    document_reference_id: str,
    signers: list[dict[str, Any]],
    callback_path: str = "/api/esign/callback",
) -> dict[str, Any]:
    """Sends a document to SignDesk's Sign Request API (UAT sandbox) for
    e-signature by one or more signers. Each entry in `signers` is
    {"ref_id", "name", "email", "mobile", "sequence", "position"}; "position"
    is optional — falls back to auto-cycling through SIGNER_POSITIONS by
    sequence when not supplied. The response's signer_info[] is matched back
    to these afterwards by ref_id.

    callback_path defaults to the legacy B2C/B2B admin webhook route; the
    public /api/v1 gateway (app/services/providers/signdesk.py) passes
    /api/v1/webhooks/signdesk/esign instead, so SignDesk calls back into the
    right handler for whichever system actually created the docket. Both
    share the same callback_secret — see verify_signdesk_webhook_secret in
    app/api_v1_auth.py.
    """
    config = _config()
    callback_url = (
        f"{config['callback_base_url'].rstrip('/')}{callback_path}"
        f"?secret={quote(config['callback_secret'])}"
    )

    body = {
        "reference_id": reference_id,
        "docket_title": docket_title,
        "remarks": "",
        # Melento's own invitation emails show "Name via Melento" + the
        # Melento logo. LegalDesk-branded branding (email_service.
        # send_esign_invitation_email) is the eventual goal, but its signing
        # link is not available — the sandbox signRequest response never
        # returns invitation_link — so Melento's email remains the working
        # invitation channel (it carries a real signing link). Keep email
        # notifications ON.
        "enable_email_notification": True,
        "documents": [
            {
                "reference_doc_id": document_reference_id,
                "content_type": "pdf",
                "content": base64.b64encode(pdf_bytes).decode("ascii"),
                # "sequential" — SignDesk enforces sign-in-order itself
                # (per-signer "sequence" below): a later signer cannot
                # complete signing until every earlier sequence number has
                # signed. We don't implement any blocking/queueing logic on
                # our side; this is entirely SignDesk-side enforcement,
                # driven by this one field.
                "signature_sequence": "sequential",
                "return_url": callback_url,
            }
        ],
        # Top-level per the Sign Request API doc (Request Parameters table —
        # callback_file_content is a sibling of "documents"/"signers_info",
        # NOT a per-document field). An earlier attempt nested this inside
        # documents[0] alongside signature_sequence/return_url, which the
        # confirmed UAT test showed SignDesk silently ignores — the
        # completion callback still came back in the bare
        # {status, signer_id, document_id} shape with no file_content.
        # Without this in the right place, signed_file_path never gets
        # populated and "Download Signed Copy" 404s for every order.
        "callback_file_content": True,
        "signers_info": [
            {
                "document_to_be_signed": document_reference_id,
                "signer_position": {
                    "appearance": signer.get("position")
                    or SIGNER_POSITIONS[(signer.get("sequence", 1) - 1) % len(SIGNER_POSITIONS)]
                },
                "signer_ref_id": signer["ref_id"],
                "signer_email": signer.get("email") or "",
                "signer_name": signer["name"],
                "sequence": signer.get("sequence", 1),
                "page_number": "last",
                "signer_mobile": signer["mobile"],
                "authentication_mode": "mobile",
                "signature_type": "electronic",
                # Without these two, SignDesk creates the docket but never
                # notifies the signer — no signing link is delivered either.
                # Trigger via email when the signer has an address (SignDesk
                # sends its "Name via Melento" invite with the working
                # signing link); SMS-only signers use Melento SMS. The
                # LegalDesk-branded email (email_service.
                # send_esign_invitation_email) can't fire yet because the
                # sandbox never returns an invitation_link to put in it.
                "trigger_esign_request": True,
                "trigger_esign_request_invitation": "email" if signer.get("email") else "sms",
            }
            for signer in signers
        ],
    }

    headers = {
        "x-parse-rest-api-key": config["api_key"],
        "x-parse-application-id": config["application_id"],
        "Content-Type": "application/json",
    }

    # Log exactly what we're asking SignDesk to create — every signer's
    # ref_id/name/email/sequence/position, in request order, with the PDF
    # bytes excluded (the only large/noisy field). This is the permanent,
    # inspectable record of "what we actually sent" that was previously
    # missing — we only ever kept SignDesk's response (raw_response in
    # b2b_esign_transaction), never the outgoing request.
    outgoing_signers = [
        {
            "sequence": s["sequence"],
            "ref_id": s["signer_ref_id"],
            "name": s["signer_name"],
            "email": s["signer_email"],
            "position": s["signer_position"]["appearance"],
        }
        for s in body["signers_info"]
    ]
    logger.info(
        "SignDesk send_sign_request: reference_id=%s, %d signer(s) in outgoing payload: %s",
        reference_id, len(body["signers_info"]), outgoing_signers,
    )

    try:
        response = requests.post(config["url"], json=body, headers=headers, timeout=30)
    except requests.RequestException as e:
        raise SignDeskError(f"Could not reach SignDesk: {e}") from e

    # A 502 from SignDesk means their gateway itself is down/unreachable —
    # the body is typically an HTML error page, not JSON, so this is checked
    # before the JSON-parsing below rather than after. Reported by
    # Nikitha/Harshitha 2026-08-28: raw error text like "SignDesk request
    # failed (HTTP 502): ..." was reaching the end user verbatim (the
    # frontend just renders err.message with no translation layer — see
    # frontend/B2B LD/src/lib/api.js). Swap it for a plain user-facing
    # message here instead; the actual response text is still logged for
    # debugging.
    if response.status_code == 502:
        logger.error(
            "SignDesk send_sign_request got HTTP 502 Bad Gateway for reference_id=%s: %s",
            reference_id, response.text[:500],
        )
        raise SignDeskError("The eSign service is temporarily unavailable. Please try again later.")

    # SignDesk's UAT sandbox can return a non-JSON body (an HTML error page
    # from a gateway timeout, WAF block, or maintenance page) instead of its
    # usual JSON response, especially on a non-2xx status. response.json()
    # raising here used to propagate as an uncaught JSONDecodeError — not a
    # requests.RequestException, so the try/except above never caught it —
    # all the way up through initiate_esign's own except SignDeskError to a
    # bare 500 with a plain-text body. The frontend's apiRequest can't parse
    # that as JSON either, so it fell back to a generic "API request failed"
    # with no indication of what actually happened. Catching it here and
    # wrapping as SignDeskError keeps this on the normal error path, which
    # already turns into a proper HTTP 502 with a real detail message.
    try:
        data = response.json() if response.content else {}
    except ValueError as e:
        raise SignDeskError(
            f"SignDesk returned a non-JSON response (HTTP {response.status_code}): {response.text[:500]}"
        ) from e
    if not response.ok:
        raise SignDeskError(f"SignDesk request failed (HTTP {response.status_code}): {data}")

    returned_signer_info = data.get("signer_info", [])
    logger.info(
        "SignDesk send_sign_request response: reference_id=%s, status=%s, docket_id=%s, "
        "%d signer_id(s) returned (sent %d): %s",
        reference_id, data.get("status"), data.get("docket_id"),
        len(returned_signer_info), len(body["signers_info"]), returned_signer_info,
    )
    if len(returned_signer_info) != len(body["signers_info"]):
        logger.error(
            "SignDesk returned %d signer_id(s) but we sent %d signers for reference_id=%s — "
            "SignDesk silently dropped one or more signers at the API level.",
            len(returned_signer_info), len(body["signers_info"]), reference_id,
        )

    return data


# es_150 ("This document can not be revoked") is the expected outcome once a
# docket has already progressed too far to revoke (e.g. everyone has already
# signed) — logged at info level rather than warning, since it's not really a
# failure of the revoke attempt.
REVOKE_ALREADY_PROGRESSED_ERROR_CODE = "es_150"


def revoke_document(*, document_id: str, docket_id: str) -> dict[str, Any]:
    """Calls SignDesk's Revoke Document API to cancel a docket whose signing
    is not yet complete. Confirmed with SignDesk support: this uses the same
    eSign credentials as the Sign Request API (SIGNDESK_ESIGN_API_KEY /
    SIGNDESK_ESIGN_APPLICATION_ID), not a separate microservice pair — only
    the endpoint URL differs."""
    url = os.getenv("SIGNDESK_ESIGN_REVOKE_URL")
    if not url:
        raise SignDeskError("SignDesk Revoke API is not configured. Set SIGNDESK_ESIGN_REVOKE_URL in backend/.env.")

    config = _config()
    headers = {
        "x-parse-rest-api-key": config["api_key"],
        "x-parse-application-id": config["application_id"],
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            url,
            json={"document_id": document_id, "docket_id": docket_id},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as e:
        raise SignDeskError(f"Could not reach SignDesk Revoke API: {e}") from e

    try:
        data = response.json() if response.content else {}
    except ValueError as e:
        raise SignDeskError(
            f"SignDesk revoke returned a non-JSON response (HTTP {response.status_code}): {response.text[:500]}"
        ) from e
    if not response.ok:
        raise SignDeskError(f"SignDesk revoke failed (HTTP {response.status_code}): {data}")
    return data


def cancel_docket(*, docket_id: str, document_id: str | None) -> None:
    """Best-effort cancellation of a previously-sent docket, called when a
    workflow is superseded by an edit or explicitly cancelled (see
    esign_service._cancel_transaction) — calls SignDesk's Revoke Document API
    via revoke_document() above.

    Never raises: the real enforcement that an old docket can no longer
    affect status or billing is DB-side (b2b_esign_transaction.is_active plus
    the active-workflow check in esign_service.record_callback), not this
    best-effort provider-side call. So a revoke failure here is only ever
    logged — SignDesk's hosted signing page may still work for a superseded
    link, but it can no longer complete anything on our side either way.
    """
    if not os.getenv("SIGNDESK_ESIGN_REVOKE_URL"):
        logger.warning(
            "SIGNDESK_ESIGN_REVOKE_URL is not configured — skipping SignDesk-side "
            "revoke of docket %s (document %s); relying on DB-side invalidation only.",
            docket_id, document_id,
        )
        return
    if not document_id:
        logger.warning(
            "Cannot revoke docket %s at SignDesk — no document_id recorded for it.", docket_id,
        )
        return

    try:
        data = revoke_document(document_id=document_id, docket_id=docket_id)
    except SignDeskError:
        logger.exception("SignDesk docket revoke errored for docket %s", docket_id)
        return

    if data.get("status") != "success":
        error_code = data.get("error_code")
        message = data.get("message")
        if error_code == REVOKE_ALREADY_PROGRESSED_ERROR_CODE:
            logger.info(
                "SignDesk: docket %s can no longer be revoked (already progressed) — %s",
                docket_id, message,
            )
        else:
            logger.warning(
                "SignDesk docket revoke failed for docket %s (error_code=%s): %s",
                docket_id, error_code, message,
            )


def resend_invitation(*, document_id: str | None, docket_id: str | None, signer_id: str | None) -> bool:
    """Best-effort reminder email to a single pending signer, called from the
    Order Detail page's "Resend Email" action. Calls SignDesk's Resend
    Invitation API (confirmed doc, page 42): request body is
    {document_id, docket_id, stakeholder_id, reference_id} — SignDesk calls
    a signer's ID "stakeholder_id" here since the same endpoint also covers
    reviewers/editors. Uses the same eSign credentials as the Sign Request
    API (confirmed with SignDesk support), not a separate microservice pair.

    Never raises. The caller (esign_service.resend_signer_invitation) still
    records that a reminder was requested regardless of the return value, so
    there's an audit trail even before/if a provider call fails.
    """
    resend_url = os.getenv("SIGNDESK_ESIGN_RESEND_URL")
    if not resend_url:
        logger.warning(
            "SIGNDESK_ESIGN_RESEND_URL is not configured — 'Resend Email' for signer %s "
            "(document %s) was recorded but no reminder email was actually sent by SignDesk.",
            signer_id, document_id,
        )
        return False
    if not docket_id:
        logger.warning(
            "Cannot call SignDesk Resend Invitation for signer %s (document %s) — no docket_id recorded.",
            signer_id, document_id,
        )
        return False

    try:
        config = _config()
        response = requests.post(
            resend_url,
            json={
                "document_id": document_id,
                "docket_id": docket_id,
                "stakeholder_id": signer_id,
                "reference_id": f"resend_{uuid.uuid4().hex}",
            },
            headers={
                "x-parse-rest-api-key": config["api_key"],
                "x-parse-application-id": config["application_id"],
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        data = response.json() if response.content else {}
        if not response.ok or str(data.get("status", "")).lower() != "success":
            logger.warning(
                "SignDesk resend failed for signer %s (HTTP %s): %s", signer_id, response.status_code, data,
            )
            return False
        return True
    except Exception:
        logger.exception("SignDesk resend errored for signer %s", signer_id)
        return False
