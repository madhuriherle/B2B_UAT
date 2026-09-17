import logging
import os

from fastapi import APIRouter, Request

from app.digilocker_service import record_digilocker_callback

logger = logging.getLogger(__name__)

# Public webhook — Melento (formerly SignDesk) calls this directly the
# moment a customer finishes DigiLocker authentication/consent (see their
# "Digilocker API - Webhook" doc). We originally required the
# x-parse-application-id/x-parse-rest-api-key header pair here (same as our
# outbound calls use), but a real UAT callback arrived with NEITHER header
# present — captured via the logging below — so that assumption was wrong
# and blocking on it rejects every genuine callback. Not enforcing any
# header check for now (UAT only; the tunnel URL itself isn't public) until
# Melento confirms what, if anything, actually authenticates this callback.
# Every attempt is still logged in full (headers + body) so a mismatch or a
# genuine payload is always visible in the logs even without blocking on it.
router = APIRouter()


@router.post("/callback")
async def digilocker_callback(request: Request) -> dict[str, object]:
    """Melento's documented response shape: {"status": "success"} once we've
    processed the callback (regardless of whether the underlying
    verification itself succeeded or failed — see
    record_digilocker_callback's docstring), or {"status": "failed",
    "error_message": ...} only if we couldn't process the callback at all.
    Must never 500 — an unparseable body still gets a well-formed response,
    logged instead of crashing the request, same defensive stance as the
    eSign callback route."""
    expected_app_id = os.getenv("SIGNDESK_DIGILOCKER_APPLICATION_ID")
    expected_api_key = os.getenv("SIGNDESK_DIGILOCKER_API_KEY")
    received_app_id = request.headers.get("x-parse-application-id")
    received_api_key = request.headers.get("x-parse-rest-api-key")
    if received_app_id != expected_app_id or received_api_key != expected_api_key:
        logger.warning(
            "DigiLocker callback arrived without matching x-parse headers (received application_id=%r api_key=%r) — "
            "processing anyway since header auth is not currently enforced. All headers: %s",
            received_app_id, received_api_key, dict(request.headers),
        )

    try:
        payload = await request.json()
    except Exception:
        raw = await request.body()
        logger.error("DigiLocker callback sent an unparseable body (%d bytes): %r", len(raw), raw[:500])
        return {"status": "failed", "error_message": "Request body is not valid JSON"}

    if not isinstance(payload, dict):
        logger.error("DigiLocker callback body was not a JSON object: %r", payload)
        return {"status": "failed", "error_message": "Request body must be a JSON object"}

    logger.info("DigiLocker callback payload: %r", payload)
    return record_digilocker_callback(payload)
