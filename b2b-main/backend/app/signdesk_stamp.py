import logging
import os
import uuid
from typing import Any

import requests

from app.config import load_backend_env

load_backend_env()

logger = logging.getLogger(__name__)


class SignDeskStampError(RuntimeError):
    def __init__(self, message: str, *, error_code: str | None = None, raw_response: dict[str, Any] | None = None):
        super().__init__(message)
        # Populated only when SignDesk actually returned a parsed JSON body
        # with status != "success" — a transport-level failure (unreachable,
        # non-JSON body, non-2xx HTTP) never had a real response to pull
        # these from, so they stay None in those cases.
        self.error_code = error_code
        self.raw_response = raw_response


def _config() -> dict[str, str]:
    url = os.getenv("SIGNDESK_STAMP_URL")
    api_key = os.getenv("SIGNDESK_STAMP_API_KEY")
    application_id = os.getenv("SIGNDESK_STAMP_APPLICATION_ID")
    if not url or not api_key or not application_id:
        raise SignDeskStampError(
            "SignDesk eStamp is not configured. Set SIGNDESK_STAMP_URL, SIGNDESK_STAMP_API_KEY "
            "and SIGNDESK_STAMP_APPLICATION_ID in backend/.env."
        )
    return {"url": url, "api_key": api_key, "application_id": application_id}


def _config_otf() -> dict[str, str]:
    # Separate credential set for "eStamp On The Fly" (Karnataka) —
    # SignDesk's requestStampPaper endpoint, a different app/API-key pair
    # than plain eStamp's requestStampPaperStamping above. The client-given
    # "api_id" is the same x-parse-application-id header plain eStamp uses,
    # just SignDesk's label for it on this credential set.
    url = os.getenv("SIGNDESK_STAMP_OTF_URL")
    api_key = os.getenv("SIGNDESK_STAMP_OTF_API_KEY")
    application_id = os.getenv("SIGNDESK_STAMP_OTF_APPLICATION_ID")
    if not url or not api_key or not application_id:
        raise SignDeskStampError(
            "SignDesk eStamp On The Fly is not configured. Set SIGNDESK_STAMP_OTF_URL, "
            "SIGNDESK_STAMP_OTF_API_KEY and SIGNDESK_STAMP_OTF_APPLICATION_ID in backend/.env."
        )
    return {"url": url, "api_key": api_key, "application_id": application_id}


def new_reference_id(order_id: str) -> str:
    return f"legaldesk_estamp_{order_id}_{uuid.uuid4().hex[:8]}"


def request_stamp_paper(*, reference_id: str, content_b64: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Calls SignDesk's DSS 2.0 Stamp Request API (requestStampPaperStamping)
    to attach a stamp paper to `content_b64` (base64 PDF). `payload` carries
    every other documented field (party details/addresses, stamp_amount,
    document_category, stamp_state, stamp_duty_paid_by, ...) built by
    stamp_service.initiate_stamp — this function only owns the transport
    (headers, endpoint, error wrapping), same split as signdesk_esign's
    send_sign_request.
    """
    config = _config()

    body = {"reference_id": reference_id, "content": content_b64, **payload}

    headers = {
        "x-parse-rest-api-key": config["api_key"],
        "x-parse-application-id": config["application_id"],
        "Content-Type": "application/json",
    }

    # Log everything except the base64 PDF content — the only large/noisy
    # field — so there's a permanent, inspectable record of what we actually
    # sent, same reasoning as send_sign_request's outgoing_signers log.
    logger.info(
        "SignDesk request_stamp_paper: reference_id=%s, payload=%s",
        reference_id, {k: v for k, v in body.items() if k != "content"},
    )

    try:
        response = requests.post(config["url"], json=body, headers=headers, timeout=30)
    except requests.RequestException as e:
        raise SignDeskStampError(f"Could not reach SignDesk: {e}") from e

    try:
        data = response.json() if response.content else {}
    except ValueError:
        # SignDesk (or something in front of it — a gateway/WAF) returned a
        # non-JSON body, most likely alongside a non-2xx status. This must
        # become a SignDeskStampError rather than propagate raw: an
        # unhandled exception here skips FastAPI's CORS middleware on its
        # way out, so the browser misreports the resulting 500 as a CORS
        # failure instead of showing the actual error.
        raise SignDeskStampError(
            f"SignDesk stamp request returned a non-JSON response (HTTP {response.status_code}): {response.text[:500]}"
        )
    if not response.ok:
        raise SignDeskStampError(f"SignDesk stamp request failed (HTTP {response.status_code}): {data}")

    logger.info(
        "SignDesk request_stamp_paper response: reference_id=%s, status=%s, error_code=%s, transaction_id=%s",
        reference_id, data.get("status"), data.get("error_code"), data.get("transaction_id"),
    )

    return data


def request_stamp_paper_otf(*, reference_id: str, content_b64: str, payload: dict[str, Any]) -> dict[str, Any]:
    """"eStamp On The Fly" (Karnataka) equivalent of request_stamp_paper
    above — same DSS 2.0 request/response shape and transport behavior
    (headers, error wrapping, non-JSON-response handling), just posted to
    the separate requestStampPaper endpoint/credential set configured via
    _config_otf. See stamp_service.initiate_stamp_otf for payload
    construction."""
    config = _config_otf()

    body = {"reference_id": reference_id, "content": content_b64, **payload}

    headers = {
        "x-parse-rest-api-key": config["api_key"],
        "x-parse-application-id": config["application_id"],
        "Content-Type": "application/json",
    }

    logger.info(
        "SignDesk request_stamp_paper_otf: reference_id=%s, payload=%s",
        reference_id, {k: v for k, v in body.items() if k != "content"},
    )

    try:
        response = requests.post(config["url"], json=body, headers=headers, timeout=30)
    except requests.RequestException as e:
        raise SignDeskStampError(f"Could not reach SignDesk: {e}") from e

    try:
        data = response.json() if response.content else {}
    except ValueError:
        raise SignDeskStampError(
            f"SignDesk stamp request (On The Fly) returned a non-JSON response (HTTP {response.status_code}): {response.text[:500]}"
        )
    if not response.ok:
        raise SignDeskStampError(f"SignDesk stamp request (On The Fly) failed (HTTP {response.status_code}): {data}")

    logger.info(
        "SignDesk request_stamp_paper_otf response: reference_id=%s, status=%s, error_code=%s, transaction_id=%s",
        reference_id, data.get("status"), data.get("error_code"), data.get("transaction_id"),
    )

    return data
