import base64
import os
import uuid
from typing import Any

import requests

from app.config import load_backend_env

load_backend_env()


class SignDeskError(RuntimeError):
    pass


def _config() -> dict[str, str]:
    url = os.getenv("SIGNDESK_EKYC_URL")
    api_key = os.getenv("SIGNDESK_EKYC_API_KEY")
    application_id = os.getenv("SIGNDESK_EKYC_APPLICATION_ID")
    if not url or not api_key or not application_id:
        raise SignDeskError(
            "SignDesk eKYC is not configured. Set SIGNDESK_EKYC_URL, SIGNDESK_EKYC_API_KEY "
            "and SIGNDESK_EKYC_APPLICATION_ID in backend/.env."
        )
    return {"url": url, "api_key": api_key, "application_id": application_id}


def new_reference_id(order_id: str) -> str:
    # Confirmed against a live SignDesk response (dv-014 "The reference_id
    # passed in the request is invalid"): unlike the Sign Request API,
    # General Document Verification's reference_id allows no special
    # characters at all — not even hyphens/underscores. Strip them, same as
    # signdesk_digilocker.new_reference_id already does for this same API.
    return f"legaldeskekyc{order_id.replace('-', '')}{uuid.uuid4().hex[:8]}"


def verify_document(
    *,
    reference_id: str,
    doc_bytes: bytes,
    doc_type: str,
    verification: bool,
) -> dict[str, Any]:
    """Calls SignDesk's General Document Verification API.

    Request body: {reference_id, source (base64), verification, doc_type}.
    Success and failure are both returned as normal JSON bodies (status:
    "success"/"failed") — only transport/HTTP errors raise SignDeskError.
    """
    config = _config()

    body = {
        "reference_id": reference_id,
        "source": base64.b64encode(doc_bytes).decode("ascii"),
        "verification": verification,
        "doc_type": doc_type,
    }

    headers = {
        "x-parse-rest-api-key": config["api_key"],
        "x-parse-application-id": config["application_id"],
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(config["url"], json=body, headers=headers, timeout=30)
    except requests.RequestException as e:
        raise SignDeskError(f"Could not reach SignDesk: {e}") from e

    data = response.json() if response.content else {}
    if not response.ok:
        raise SignDeskError(f"SignDesk request failed (HTTP {response.status_code}): {data}")

    return data
