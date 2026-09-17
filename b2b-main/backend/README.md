# LegalDesk B2B Backend

Python FastAPI + PostgreSQL API for the B2B onboarding and quotation flow.

This backend uses the new B2B tables:

- `organizations`
- `organization_users`
- `quotations`
- `quotation_services`
- `customer_service_access`

It reuses existing B2C tables directly for shared data:

- `users`
- `role`
- `state`
- `document`
- `stamp_denomination`
- `document_stamp_denomination`
- `payment_transaction`
- `payment_transaction_meta`
- `razorpay_transaction`
- `user_doc`
- `document_templates`
- `support_requests`
- `doc_messages`

## Setup

```bash
cd backend
copy .env.example .env
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
psql "$DATABASE_URL" -f db/schema.sql   # creates/updates the B2B-specific tables
uvicorn app.main:app --reload --port 8000
```

Set `DATABASE_URL` in `.env` to your PostgreSQL database — it must be the same
database (or a full copy of it) as the existing B2C app, since this backend
reuses its tables directly (see list above). `db/schema.sql` only creates the
B2B-specific tables/columns layered on top; it does not create the B2C base
tables.

## Deploying

- `Dockerfile` builds a production image (`uvicorn`, no `--reload`).
- Required env vars at runtime: `DATABASE_URL`, `FRONTEND_URL`, `SECRET_KEY`,
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `PORT`
  (see `.env.example`). Set these directly in your host's environment/secrets
  manager — never commit a production `.env`.
- Generate a fresh `SECRET_KEY` for production (don't reuse the one from local
  `.env`): `python -c "import secrets; print(secrets.token_hex(32))"`.
- Run `db/schema.sql` against the target database before the first deploy,
  and again after pulling changes that touch `db/schema.sql`.

## Main API

```http
GET    /health

GET    /api/organizations
POST   /api/organizations
GET    /api/organizations/:id
PATCH  /api/organizations/:id
GET    /api/organizations/:id/users
POST   /api/organizations/:id/users
GET    /api/organizations/:id/service-access
POST   /api/organizations/:id/service-access

GET    /api/quotations
POST   /api/quotations
GET    /api/quotations/token/:token
POST   /api/quotations/:id/accept

GET    /api/catalog/states
GET    /api/catalog/users
GET    /api/catalog/documents
GET    /api/catalog/document-stamp-denominations
GET    /api/catalog/user-documents/:userId
GET    /api/catalog/payments/:userDocId
```

## Create Quotation Payload

```json
{
  "organization_id": "organization-uuid",
  "pricing_type": "one_time",
  "amount": 5000,
  "gst_percentage": 18,
  "billing_cycle": null,
  "services": [
    { "service_name": "eSign", "service_price": 2500 },
    { "service_name": "eKYC", "service_price": 2500 }
  ]
}
```

The API stores enabled services in `quotation_services`. When a quotation is accepted, those services become active in `customer_service_access`.
