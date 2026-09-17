import os
import uuid
from typing import Any

import requests

from app.config import load_backend_env

load_backend_env()


class SignDeskError(RuntimeError):
    pass


def _config() -> dict[str, str]:
    url = os.getenv("SIGNDESK_DIGILOCKER_URL")
    api_key = os.getenv("SIGNDESK_DIGILOCKER_API_KEY")
    application_id = os.getenv("SIGNDESK_DIGILOCKER_APPLICATION_ID")
    if not url or not api_key or not application_id:
        raise SignDeskError(
            "SignDesk DigiLocker is not configured. Set SIGNDESK_DIGILOCKER_URL, "
            "SIGNDESK_DIGILOCKER_API_KEY and SIGNDESK_DIGILOCKER_APPLICATION_ID in backend/.env."
        )
    return {"url": url, "api_key": api_key, "application_id": application_id}


def _aadhaar_details_config() -> dict[str, str]:
    # Get Aadhaar Details is a distinct endpoint from Generate URL above, but
    # confirmed by SignDesk to share the same api_key/application_id — only
    # the URL differs, same pattern as revoke_document reusing eSign creds.
    url = os.getenv("SIGNDESK_DIGILOCKER_AADHAAR_DETAILS_URL")
    if not url:
        raise SignDeskError(
            "SignDesk DigiLocker Get Aadhaar Details is not configured. "
            "Set SIGNDESK_DIGILOCKER_AADHAAR_DETAILS_URL in backend/.env."
        )
    config = _config()
    return {"url": url, "api_key": config["api_key"], "application_id": config["application_id"]}


def new_reference_id(order_id: str) -> str:
    # The General Document Verification API's docs note reference_id may not
    # contain special characters; DigiLocker's docs don't repeat that note,
    # but there's no reason to risk it — strip the UUID's hyphens instead of
    # carrying them through like signdesk_ekyc.new_reference_id does.
    return f"ldekycdl{order_id.replace('-', '')}{uuid.uuid4().hex[:8]}"


def generate_url(*, reference_id: str, source: str = "AADHAAR") -> dict[str, Any]:
    """Calls SignDesk's Generate DigiLocker URL API.

    Request body: {reference_id, source}. On success the response already
    contains transaction_id alongside result.link — DigiLocker auth doesn't
    hand it back later, so it must be captured here for the follow-up Get
    Aadhaar Details call. Success and failure are both normal JSON bodies
    (status: "success"/"failed") — only transport/HTTP errors raise
    SignDeskError, same convention as signdesk_ekyc.verify_document.
    """
    config = _config()

    body = {"reference_id": reference_id, "source": source}

    headers = {
        "x-parse-application-id": config["application_id"],
        "x-parse-rest-api-key": config["api_key"],
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


def get_aadhaar_details(*, reference_id: str, transaction_id: str) -> dict[str, Any]:
    """Calls SignDesk's Get Aadhaar Details API — the follow-up step after
    the user completes DigiLocker auth via the link from generate_url().
    Request body: {reference_id, transaction_id} — the transaction_id must
    be the one returned by generate_url() for this same order, not a new
    one. Response includes "uid" (the full Aadhaar number) and "xml_file"
    (DigiLocker's raw offline XML, which itself embeds the Aadhaar number);
    the caller (digilocker_service.fetch_aadhaar_details) is responsible for
    never persisting either — see the schema comment on
    b2b_digilocker_verification.aadhaar_data.
    """
    config = _aadhaar_details_config()

    body = {"reference_id": reference_id, "transaction_id": transaction_id}

    headers = {
        "x-parse-application-id": config["application_id"],
        "x-parse-rest-api-key": config["api_key"],
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
