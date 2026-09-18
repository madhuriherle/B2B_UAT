import logging
import os

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api_v1_auth import ApiAuthError
from app.auth import get_current_admin
from app.config import load_backend_env

# No logging.basicConfig existed anywhere in the app, so the root logger
# defaulted to WARNING — every logger.info() call across the codebase (e.g.
# the SignDesk request/response audit trail in signdesk_esign.py) was being
# silently swallowed rather than actually reaching the console/log file.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
from app.routes import (
    accounts,
    api_clients,
    api_v1,
    api_v1_webhooks,
    article_codes,
    auth,
    catalog,
    charges,
    customers,
    dashboard,
    digilocker,
    document_service,
    esign,
    esign_admin,
    estamp_bulk,
    manual_estamp,
    notifications,
    organizations,
    partner,
    partner_user,
    price_history,
    quotations,
    reports,
    roles,
    services,
    stamps,
    vendors,
)

# Admin Portal (platform_admin role) — B2B superadmin features (via the
# broadened get_current_admin, see app/auth.py) plus these B2C admin
# routers, gated by app.b2c_admin.deps.get_current_b2c_admin
# (get_current_platform_admin) instead. Same login, same session, no
# second auth system — just a stricter role check.
from app.b2c_admin.print_delivery import service as b2c_print_delivery_service
from app.b2c_admin.print_delivery import stamp_denom as b2c_print_delivery_stamp_denom
from app.b2c_admin.routes import (
    admin_categories as b2c_admin_categories,
    admin_dashboard as b2c_admin_dashboard,
    admin_doc_state_config as b2c_admin_doc_state_config,
    admin_documents as b2c_admin_documents,
    admin_invoices as b2c_admin_invoices,
    admin_message as b2c_admin_message,
    admin_orders as b2c_admin_orders,
    admin_reports as b2c_admin_reports,
    admin_states as b2c_admin_states,
    admin_support as b2c_admin_support,
    admin_templates as b2c_admin_templates,
    admin_user_docs as b2c_admin_user_docs,
    customers as b2c_customers,
    messages as b2c_messages,
)

load_backend_env()

app = FastAPI(title="LegalDesk B2B API", version="1.0.0")

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    # Vite auto-increments the port (5173 -> 5174 -> 5175 ...) if an earlier
    # one is already bound, so dev sessions commonly land on something other
    # than 5173 — allow the whole local range rather than a single origin.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):51(7[3-9]|8[0-9])",
    allow_origins=[frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def strip_server_header(request: Request, call_next):
    """Do not advertise the ASGI server name/version to clients."""
    response = await call_next(request)
    if "server" in response.headers:
        del response.headers["server"]
    return response


@app.get("/health")
def health():
    return {"status": "ok", "service": "legaldesk-b2b-api", "runtime": "python"}


@app.exception_handler(ApiAuthError)
def handle_api_auth_error(request: Request, exc: ApiAuthError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"success": False, "message": exc.message})


admin_only = [Depends(get_current_admin)]

# auth.router is intentionally unprotected at the router level — it mixes public
# endpoints (login, reset-token, set-password) with admin-only ones (me, test-mail),
# so each protected endpoint inside it declares its own dependency instead.
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(organizations.router, prefix="/api/organizations", tags=["organizations"], dependencies=admin_only)
app.include_router(vendors.router, prefix="/api/vendors", tags=["vendors"], dependencies=admin_only)
app.include_router(quotations.router, prefix="/api/quotations", tags=["quotations"])
app.include_router(catalog.public_router, prefix="/api/catalog", tags=["catalog"])
app.include_router(catalog.router, prefix="/api/catalog", tags=["catalog"], dependencies=admin_only)
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"], dependencies=admin_only)
app.include_router(stamps.router, prefix="/api/stamps", tags=["stamps"], dependencies=admin_only)
app.include_router(services.router, prefix="/api/services", tags=["services"], dependencies=admin_only)
app.include_router(charges.router, prefix="/api/charges", tags=["charges"], dependencies=admin_only)
app.include_router(article_codes.router, prefix="/api/article-codes", tags=["article-codes"], dependencies=admin_only)
app.include_router(roles.router, prefix="/api/roles", tags=["roles"], dependencies=admin_only)
app.include_router(document_service.router, prefix="/api/document-service", tags=["document-service"], dependencies=admin_only)
app.include_router(reports.router, prefix="/api/reports", tags=["reports"], dependencies=admin_only)
app.include_router(estamp_bulk.router, prefix="/api/estamp-bulk", tags=["estamp-bulk"], dependencies=admin_only)
app.include_router(manual_estamp.router, prefix="/api/manual-estamp", tags=["manual-estamp"], dependencies=admin_only)
app.include_router(esign_admin.router, prefix="/api/esign-admin", tags=["esign-admin"], dependencies=admin_only)

from app.routes import loan_documents
app.include_router(loan_documents.router, prefix="/api/admin/loan-config", tags=["loan-config"], dependencies=admin_only)

# partner.py declares Depends(get_current_partner) on each endpoint individually (it also
# needs the resolved organization_id, not just a boolean gate), so no router-level dependency here.
app.include_router(partner.router, prefix="/api/partner", tags=["partner"])
# Partner User portal (Cyber Shops) — same per-endpoint Depends(get_current_partner_user)
# pattern as partner.router above, one tier down (organization_id AND organization_user_id
# both resolved from the token, never from the request).
app.include_router(partner_user.router, prefix="/api/partner-user", tags=["partner-user"])
# Partner-facing notifications bell — reachable by either partner-side login
# (Depends(get_current_partner_or_member) per endpoint), so no router-level
# dependency here either.
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
# Super Admin/Admin Portal notifications bell — global feed, gated like every
# other admin_only router below.
app.include_router(notifications.admin_router, prefix="/api/admin/notifications", tags=["notifications"], dependencies=admin_only)
# SignDesk's webhook — gated by a shared secret checked per-endpoint, not a
# router-level dependency, since it's a grace-period check rather than a hard
# gate (see verify_esign_callback_secret in app/routes/esign.py).
app.include_router(esign.router, prefix="/api/esign", tags=["esign"])
# Melento/SignDesk's DigiLocker webhook — gated per-endpoint by the
# x-parse-application-id/x-parse-rest-api-key header pair (see
# verify_digilocker_callback_headers in app/routes/digilocker.py).
app.include_router(digilocker.router, prefix="/api/digilocker", tags=["digilocker"])
app.include_router(customers.router, prefix="/api/customers", tags=["customers"], dependencies=admin_only)
app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"], dependencies=admin_only)
app.include_router(price_history.router, prefix="/api/price-history", tags=["price-history"], dependencies=admin_only)
app.include_router(api_clients.router, prefix="/api/api-clients", tags=["api-clients"], dependencies=admin_only)
# Public API — external customers (see Add API Client), gated by
# api_v1_auth.validate_api_credentials (its own dependency, not admin_only).
app.include_router(api_v1.router, prefix="/api/v1", tags=["api-v1"])
# SignDesk's own callback into the gateway — gated by its own shared-secret
# dependency instead (verify_signdesk_webhook_secret), not customer API keys.
app.include_router(api_v1_webhooks.router, prefix="/api/v1/webhooks", tags=["api-v1-webhooks"])

# ── Admin Portal: B2C admin module ──────────────────────────────────────────
# No prefix override here: each router already declares its own /api/admin/...
# prefix and depends on get_current_b2c_admin (platform_admin-only) individually
# — except b2c_admin_orders and b2c_admin_reports, which depend on
# app.auth.get_current_admin directly so B2B Super Admin ('admin') can reach
# them too, alongside platform_admin. See app/b2c_admin/deps.py.
app.include_router(b2c_admin_dashboard.router)
app.include_router(b2c_admin_orders.router)
app.include_router(b2c_admin_reports.router)
app.include_router(b2c_admin_user_docs.router)
app.include_router(b2c_admin_templates.router)
app.include_router(b2c_admin_templates.preview_router)
app.include_router(b2c_admin_states.router)
app.include_router(b2c_admin_documents.router)
app.include_router(b2c_admin_categories.router)
app.include_router(b2c_admin_doc_state_config.router)
app.include_router(b2c_admin_invoices.router)
app.include_router(b2c_admin_support.admin_router)
app.include_router(b2c_admin_message.router)
app.include_router(b2c_messages.router)
app.include_router(b2c_print_delivery_service.router)
app.include_router(b2c_print_delivery_stamp_denom.router)
app.include_router(b2c_customers.router)
