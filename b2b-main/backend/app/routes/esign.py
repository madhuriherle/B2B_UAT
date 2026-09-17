import json
import logging
import os
from typing import Any
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from app.esign_service import record_callback

logger = logging.getLogger(__name__)

# Public webhook — SignDesk calls this directly. Gated by a shared secret
# (see verify_esign_callback_secret) rather than the no-auth setup this used
# to have, since it now triggers real wallet debits.
router = APIRouter()


def verify_esign_callback_secret(
    secret: str | None = Query(default=None),
    x_esign_callback_secret: str | None = Header(default=None, alias="X-Esign-Callback-Secret"),
) -> None:
    """Grace-period rollout: a *wrong* secret is always rejected, but a
    *missing* one is only rejected once SIGNDESK_ESIGN_CALLBACK_ENFORCE_SECRET
    is turned on — dockets created with SignDesk before this secret existed
    have no secret baked into their stored callback URL, and would otherwise
    silently stop updating the moment this check goes live."""
    expected = os.getenv("SIGNDESK_ESIGN_CALLBACK_SECRET")
    if not expected:
        raise HTTPException(status_code=500, detail="Callback secret is not configured")

    provided = secret or x_esign_callback_secret
    if provided is None:
        enforce = os.getenv("SIGNDESK_ESIGN_CALLBACK_ENFORCE_SECRET", "false").lower() == "true"
        if enforce:
            raise HTTPException(status_code=401, detail="Missing callback secret")
        logger.warning("eSign callback received with no secret (grace period) — legacy docket?")
        return

    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid callback secret")


def _parse_callback_body(raw_body: bytes) -> dict[str, Any]:
    """SignDesk's documented callback sample shows a JSON body, but in
    practice this endpoint is hit by the signer's own browser being
    redirected here after completing signing (return_url doubles as both a
    server callback and a browser redirect target — see the SignDesk API
    doc), which sends the data as application/x-www-form-urlencoded
    (`status=success&document_id=...&signer_id=...`), not JSON. Try JSON
    first since that's documented, then fall back to form/querystring
    parsing since that's what's actually been observed, so neither shape
    crashes or silently drops the event."""
    if not raw_body:
        return {"_empty_body": True}

    try:
        return json.loads(raw_body)
    except json.JSONDecodeError:
        pass

    text = raw_body.decode("utf-8", errors="replace")
    parsed = parse_qs(text)
    if parsed:
        return {k: v[0] for k, v in parsed.items()}

    logger.error("eSign callback sent an unparseable body (%d bytes): %r", len(raw_body), raw_body[:500])
    return {"_raw_body": text[:2000]}


@router.post("/callback", dependencies=[Depends(verify_esign_callback_secret)])
async def esign_callback(request: Request) -> RedirectResponse:
    """SignDesk's real behavior around this endpoint hasn't fully matched the
    documented payload shape in practice — this must never 500 on a body we
    don't recognize, or an unexpected event/format from SignDesk takes down
    request processing instead of just getting logged.

    record_callback always runs first and does exactly what it always did —
    logs the callback, applies the signer status update, auto-generates the
    invoice on completion — completely unaffected by anything below. Only
    the HTTP RESPONSE changes: this endpoint's return_url is what SignDesk
    redirects the signer's own browser to right after they finish signing
    (see _parse_callback_body's docstring — that's also how the callback
    data actually arrives here, as a form-encoded POST, not a separate
    server-to-server JSON call), so responding with record_callback's raw
    {"status", "data", ...} dict meant the signer's browser landed on bare
    JSON instead of anything resembling a finished signing flow. Redirects
    on to a plain frontend page instead — 303 so the browser follows up
    with a GET regardless of this request having been a POST (POST/Redirect/
    GET), landing on FRONTEND_URL (the same env var email links/reset links
    already use, see partner.py/organizations.py/quotations.py) rather than
    a new, separately-configured URL.
    """
    raw_body = await request.body()
    payload = _parse_callback_body(raw_body)
    result = record_callback(payload)

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    status = "success" if result.get("status") == "success" else "failed"
    return RedirectResponse(url=f"{frontend_url}/esign/complete?status={status}", status_code=303)
