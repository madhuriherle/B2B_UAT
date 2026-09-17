import os
from types import SimpleNamespace

from fastapi import Depends, Header, Query, Request

from app.database import get_connection


# app/main.py registers the handler that turns this into the public v1 API's
# {"success": false, "message": ...} shape, instead of the admin API's
# default {"detail": ...} HTTPException body.
class ApiAuthError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message


def validate_api_credentials(
    request: Request,
    x_api_id: str | None = Header(default=None, alias="X-API-ID"),
    x_api_key: str | None = Header(default=None, alias="X-API-KEY"),
) -> None:
    if not x_api_id or not x_api_key:
        raise ApiAuthError(401, "Invalid API credentials")

    with get_connection() as connection:
        client = connection.execute(
            "SELECT * FROM api_clients WHERE api_id = %s AND api_key = %s",
            (x_api_id, x_api_key),
        ).fetchone()

    if not client:
        raise ApiAuthError(401, "Invalid API credentials")
    if not client["is_active"]:
        raise ApiAuthError(403, "API client is inactive")

    # SimpleNamespace, not the raw dict, so endpoints can do
    # request.state.api_client.company_name as planned for logging/billing.
    request.state.api_client = SimpleNamespace(**client)


def require_service(service_name: str):
    # A factory (Depends(require_service("esign"))), not one function per
    # service, so a new service is just a new call site, never a code change
    # here. _check depends on validate_api_credentials itself (not router
    # ordering) so request.state.api_client is guaranteed set — FastAPI's
    # dependency cache means the credential lookup still only runs once.
    wanted = service_name.strip().lower()

    def _check(request: Request, _: None = Depends(validate_api_credentials)) -> None:
        client = request.state.api_client
        allowed = {s.strip().lower() for s in (client.allowed_services or [])}
        if wanted not in allowed:
            raise ApiAuthError(403, "Service not enabled for this API client")

    return _check


# Gates /api/v1/webhooks/signdesk/* — SignDesk calls these directly, so there
# is no X-API-ID/X-API-KEY (that's for customers calling us, not SignDesk
# calling back). Reuses the same shared secret already configured for the
# legacy /api/esign/callback route (see routes/esign.py) since that's the
# value send_sign_request already embeds in the callback_url it registers
# with SignDesk — no new .env configuration needed. Unlike that legacy
# route's grace-period carve-out, every docket created through this gateway
# is created with this secret already wired in, so it's always enforced here.
def verify_signdesk_webhook_secret(
    secret: str | None = Query(default=None),
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
) -> None:
    expected = os.getenv("SIGNDESK_ESIGN_CALLBACK_SECRET")
    if not expected:
        raise ApiAuthError(500, "Webhook secret is not configured")

    provided = secret or x_webhook_secret
    if not provided or provided != expected:
        raise ApiAuthError(401, "Invalid webhook credentials")
