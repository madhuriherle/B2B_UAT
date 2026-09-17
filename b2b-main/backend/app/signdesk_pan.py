import os
import uuid
from typing import Any

import requests

from app.config import load_backend_env

load_backend_env()


class SignDeskError(RuntimeError):
    pass


def _config() -> dict[str, str]:
    url = os.getenv("SIGNDESK_PAN_URL")
    api_key = os.getenv("SIGNDESK_PAN_API_KEY")
    application_id = os.getenv("SIGNDESK_PAN_APPLICATION_ID")
    if not url or not api_key or not application_id:
        raise SignDeskError(
            "SignDesk PAN Verification is not configured. Set SIGNDESK_PAN_URL, SIGNDESK_PAN_API_KEY "
            "and SIGNDESK_PAN_APPLICATION_ID in backend/.env."
        )
    return {"url": url, "api_key": api_key, "application_id": application_id}


def new_reference_id(order_id: str) -> str:
    # Same "no special characters" rule confirmed live against the sibling
    # General Document Verification API (dv-014) — this PAN Verification API
    # shares the same dv-0xx error code family, so applying it here too
    # rather than risking a guess.
    return f"legaldeskpan{order_id.replace('-', '')}{uuid.uuid4().hex[:8]}"


def verify_pan(*, reference_id: str, source_type: str, source: str) -> dict[str, Any]:
    """Calls SignDesk's (dedicated) PAN Verification API.

    Request body: {reference_id, source_type, source}. source_type is
    "base64" (source = base64 image/PDF of the PAN card) or "id" (source =
    the bare PAN number string, no image needed). Success and failure are
    both normal JSON bodies (status: "success"/"failed") — only
    transport/HTTP errors raise SignDeskError, same convention as
    signdesk_ekyc.verify_document.
    """
    config = _config()

    body = {"reference_id": reference_id, "source_type": source_type, "source": source}

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
