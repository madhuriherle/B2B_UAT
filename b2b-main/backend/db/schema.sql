-- B2B-specific schema for this app. All statements are idempotent
-- (CREATE ... IF NOT EXISTS / ALTER ... ADD COLUMN IF NOT EXISTS), so this
-- is safe to run repeatedly against the target database.
--
-- PREREQUISITE: this app shares its database with an existing B2C
-- application and does NOT create that app's tables. Run this script
-- against a database that already has: users, role, state, document,
-- stamp_denomination, document_stamp_denomination, payment_transaction,
-- payment_transaction_meta, razorpay_transaction, user_doc,
-- document_templates, support_requests, doc_messages, doc_state_config.
-- See backend/README.md for the full list.
--
-- Usage: psql "$DATABASE_URL" -f backend/db/schema.sql

-- =========================================
-- USERS (two-factor authentication)
-- =========================================
-- `users` itself is a pre-existing B2C table (see PREREQUISITE note above) —
-- these columns add per-user email-OTP 2FA on top of it. Login-time OTPs are
-- stored as a bcrypt hash (see auth.hash_password), same as password_hash,
-- rather than in a separate table, mirroring how password_reset_token/
-- password_reset_expires_at already do one-shot-token-on-the-users-row.

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0;
-- Bumped on logout / password change so outstanding JWTs stop authenticating
-- even before their exp claim. Access tokens carry this value as `tv`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- =========================================
-- ORGANIZATIONS
-- =========================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_name VARCHAR(255) NOT NULL,
    -- Fixed hierarchy: 'Dealer' | 'Retailer'. Existing pre-migration rows may
    -- still hold legacy free-text values (e.g. 'Private Limited') — the API
    -- only enforces the fixed set on create and on actual value changes, so
    -- old rows keep working untouched.
    organization_type VARCHAR(100),

    -- Required when organization_type = 'Retailer'. One of: Banks,
    -- Co-Operative Bank, Co-Operative Societies, NBFC, PSC.
    retailer_category VARCHAR(100),

    -- 'Wallet' (prepaid, deducted from organization_wallet) or 'PPS' (Self
    -- Pay Per Service — no wallet deduction; billed individually).
    payment_mode VARCHAR(20) NOT NULL DEFAULT 'Wallet',

    -- Set when a Dealer onboards this organization as one of their own
    -- Retailers (self-reference). NULL for Dealers and for Retailers not
    -- created under a Dealer.
    dealer_id UUID REFERENCES organizations(id),

    contact_person VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile VARCHAR(20),

    state_id UUID REFERENCES state(id),

    gst_number VARCHAR(50),

    address TEXT,

    is_active BOOLEAN DEFAULT true,

    -- Links this organization to the `users` row (role='partner') that logs
    -- into the Partner Portal and manages this organization's own users.
    portal_user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS portal_user_id UUID REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_portal_user_id_key ON organizations(portal_user_id) WHERE portal_user_id IS NOT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retailer_category VARCHAR(100);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) NOT NULL DEFAULT 'Wallet';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES organizations(id);

-- Structured replacement for the free-text `address` column above (kept in
-- place for any legacy rows that still only have it filled). New/edited
-- partners fill these instead; state still comes from the existing state_id.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);


-- =========================================
-- B2B CUSTOMERS (master, used by B2B Invoices)
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    gstin VARCHAR(50),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- B2B INVOICES (manual creation)
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    invoice_number VARCHAR(50) UNIQUE NOT NULL,

    customer_id UUID NOT NULL
        REFERENCES b2b_customers(id),

    invoice_type VARCHAR(50) NOT NULL
        CHECK (
            invoice_type IN (
                'Reimbursement',
                'Invoice'
            )
        ),

    invoice_date DATE DEFAULT CURRENT_DATE,
    due_date DATE DEFAULT CURRENT_DATE,
    terms VARCHAR(100) DEFAULT 'Due on Receipt',

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- B2B INVOICE ITEMS
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_invoice_items (
    id SERIAL PRIMARY KEY,

    invoice_id UUID NOT NULL
        REFERENCES b2b_invoices(id)
        ON DELETE CASCADE,

    description VARCHAR(255) NOT NULL,
    hsn_sac VARCHAR(50),

    qty NUMERIC(10,2) NOT NULL DEFAULT 1,
    rate NUMERIC(12,2) NOT NULL,

    cgst_percentage NUMERIC(5,2) DEFAULT 0,
    sgst_percentage NUMERIC(5,2) DEFAULT 0,

    amount NUMERIC(12,2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- IGST applies for out-of-state (non-Karnataka) customers, as an alternative
-- to the CGST+SGST split above (intra-state). Added after the table above —
-- schema.sql only anticipated CGST/SGST originally.
ALTER TABLE b2b_invoice_items ADD COLUMN IF NOT EXISTS igst_percentage NUMERIC(5,2) DEFAULT 0;

-- Auto-generated invoices for real B2B orders (User Panel -> My Orders ->
-- Download Invoice), reusing this same table/PDF pipeline instead of a
-- separate one — see app/invoice_service.py. These invoices have no
-- b2b_customers row (an order's "customer" is the partner organization, whose
-- address doesn't split into city/postal_code the way b2b_customers requires)
-- so customer_id is nullable here and the Bill To details are snapshotted
-- directly onto bill_to_* at generation time instead — both so the invoice
-- is immune to later edits to the organization's profile, and so it doesn't
-- need a b2b_customers row fabricated just to hang a join off of.
ALTER TABLE b2b_invoices ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS bill_to_name VARCHAR(255);
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS bill_to_address TEXT;
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS bill_to_state VARCHAR(100);
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS bill_to_gstin VARCHAR(50);

-- One invoice per (order, invoice_type) — widened from the original "one
-- invoice per order" now that eStamp Bulk generates BOTH a Reimbursement
-- invoice (stamp value) and a normal Invoice (service/delivery/
-- documentation charges) for the same order at completion (see
-- update_bulk_estamp_order_status / invoice_service._resolve_order_invoice).
-- Every other order type still only ever creates one invoice_type per
-- order, so this is a no-op widening for them — retrying generation for the
-- same (order_id, invoice_type) still just finds the existing row instead
-- of inserting a duplicate; see get_or_create_invoice_for_order.
DROP INDEX IF EXISTS idx_b2b_invoices_order_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_invoices_order_id_type
    ON b2b_invoices(order_id, invoice_type) WHERE order_id IS NOT NULL;

-- eStamp reimbursement wallet funding invoices — generated when Super Admin
-- credits an org's (or Retailer's) eStamp wallet, not tied to any order (see
-- app/invoice_service.py's get_or_create_reimbursement_invoice_for_wallet_credit,
-- called from app/routes/organizations.py's create_wallet_transaction).
-- organization_id/organization_user_id are populated going forward for BOTH
-- new order invoices and new recharge invoices (existing rows are left NULL,
-- unchanged) so the User Portal's new Invoices page can query this table
-- directly instead of joining through orders or wallet_transactions.
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS organization_user_id UUID REFERENCES organization_users(id) ON DELETE SET NULL;
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS wallet_transaction_id UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL;
ALTER TABLE b2b_invoices ADD COLUMN IF NOT EXISTS organization_user_wallet_transaction_id UUID REFERENCES organization_user_wallet_transactions(id) ON DELETE SET NULL;

-- One invoice per wallet-credit event — same idempotency reasoning as
-- idx_b2b_invoices_order_id above.
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_invoices_wallet_transaction_id
    ON b2b_invoices(wallet_transaction_id) WHERE wallet_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_invoices_org_user_wallet_transaction_id
    ON b2b_invoices(organization_user_wallet_transaction_id) WHERE organization_user_wallet_transaction_id IS NOT NULL;


-- =========================================
-- INVOICE NUMBER SETTINGS
-- Single configurable row controlling how b2b_invoices.invoice_number is
-- generated (see backend/app/routes/accounts.py). next_number is advanced
-- atomically on each invoice creation.
-- =========================================

-- Deprecated: invoice numbers now use the type + fiscal-year scheme in
-- invoice_number_sequences below (INV/ST/26/27-0001 for Reimbursement,
-- INV/26/27-0001 for Invoice). This table is no longer read or written by
-- the app; kept as-is (not dropped) since it's harmless and may still hold
-- historical configuration.
CREATE TABLE IF NOT EXISTS invoice_number_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
    padding_width INTEGER NOT NULL DEFAULT 6,
    next_number INTEGER NOT NULL DEFAULT 1,

    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO invoice_number_settings (prefix, padding_width, next_number)
SELECT 'INV', 6, 1
WHERE NOT EXISTS (SELECT 1 FROM invoice_number_settings);


-- =========================================
-- INVOICE NUMBER SEQUENCES
-- One counter per (invoice_type, fiscal_year_start) — Indian fiscal year runs
-- Apr-Mar, so fiscal_year_start is the calendar year the FY begins in (e.g.
-- 2026 for FY 2026-27). Numbers are formatted as INV/ST/26/27-0001
-- (Reimbursement) or INV/26/27-0001 (Invoice); see app/routes/accounts.py.
-- =========================================

CREATE TABLE IF NOT EXISTS invoice_number_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    invoice_type VARCHAR(50) NOT NULL
        CHECK (invoice_type IN ('Reimbursement', 'Invoice')),
    fiscal_year_start SMALLINT NOT NULL,

    next_number INTEGER NOT NULL DEFAULT 1,

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (invoice_type, fiscal_year_start)
);


-- =========================================
-- ORGANIZATION USERS
-- =========================================

CREATE TABLE IF NOT EXISTS organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    role VARCHAR(50) DEFAULT 'member',
    mobile VARCHAR(20),

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS mobile VARCHAR(20);


-- =========================================
-- QUOTATIONS
-- =========================================

CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    quotation_token VARCHAR(255) UNIQUE NOT NULL,

    pricing_type VARCHAR(50), -- subscription / one_time

    amount NUMERIC(10,2) NOT NULL,

    gst_percentage NUMERIC(5,2) DEFAULT 18,

    total_amount NUMERIC(10,2),

    billing_cycle VARCHAR(50), -- monthly / yearly

    quotation_status VARCHAR(50) DEFAULT 'pending'
        CHECK (
            quotation_status IN (
                'draft',
                'pending',
                'sent',
                'accepted',
                'rejected'
            )
        ),

    quotation_link TEXT,

    mail_sent BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- QUOTATION SERVICES
-- =========================================

CREATE TABLE IF NOT EXISTS quotation_services (
    id SERIAL PRIMARY KEY,

    quotation_id UUID NOT NULL
        REFERENCES quotations(id)
        ON DELETE CASCADE,

    service_name VARCHAR(100) NOT NULL
        CHECK (
            service_name IN (
                'eSign',
                'eKYC',
                'eStamp'
            )
        ),

    service_price NUMERIC(10,2),

    is_enabled BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- CUSTOMER SERVICE ACCESS
-- =========================================

CREATE TABLE IF NOT EXISTS customer_service_access (
    id SERIAL PRIMARY KEY,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    service_name VARCHAR(100) NOT NULL
        CHECK (
            service_name IN (
                'eSign',
                'eKYC',
                'eStamp'
            )
        ),

    is_active BOOLEAN DEFAULT true,

    quotation_id UUID
        REFERENCES quotations(id)
        ON DELETE SET NULL,

    activated_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- B2B STAMP DENOMINATION
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_stamp_denomination (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    state_id UUID NOT NULL
        REFERENCES state(id),

    stamp_value NUMERIC(10,2) NOT NULL,

    description TEXT,

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per (state, value) — lets eStamp Bulk order creation find-or-create
-- a denomination on the fly when a partner types a custom amount instead of
-- picking a Super-Admin-configured one (see partner.create_bulk_estamp_order),
-- without ever creating a duplicate master row for the same amount.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'b2b_stamp_denomination_state_value_key'
    ) THEN
        ALTER TABLE b2b_stamp_denomination
            ADD CONSTRAINT b2b_stamp_denomination_state_value_key UNIQUE (state_id, stamp_value);
    END IF;
END $$;


-- =========================================
-- STAMP DENOMINATION PRICE HISTORY (audit trail)
-- =========================================

CREATE TABLE IF NOT EXISTS stamp_denomination_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    stamp_denomination_id UUID NOT NULL
        REFERENCES b2b_stamp_denomination(id)
        ON DELETE CASCADE,

    stamp_value NUMERIC(10,2) NOT NULL,

    changed_by UUID REFERENCES users(id),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- SERVICE MASTER
-- Super Admin master list backing "Manage Services" (organization_service_pricing.service_name
-- and orders.service_name reference these names). "Print & Delivery" was removed here.
-- =========================================

CREATE TABLE IF NOT EXISTS service (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    service_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,

    status BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 'Document Service' must be seeded here (not just documented) — it's the
-- exact, case-sensitive name app/routes/document_service.py and
-- app/routes/organizations.py compare against to gate the whole Document
-- Service Configuration feature. Without this row it can't be turned on from
-- Manage Services on a fresh database.
-- 'eStamp Bulk' — a separate, internally-processed service (no SignDesk
-- integration): a partner requests a batch of blank stamp papers across one
-- or more denominations for a state, physically delivered. See
-- B2B ESTAMP BULK ORDER below.
INSERT INTO service (service_name) VALUES
    ('eStamp'), ('eSBTR'), ('eSign'), ('eNotary'), ('eKYC'), ('Document Service'), ('eStamp Bulk')
ON CONFLICT (service_name) DO NOTHING;


-- =========================================
-- CHARGE MASTER
-- Super Admin master list backing the "Charges" panel on Manage Services
-- (organization_charge_pricing.charge_name references these names) —
-- mirrors the SERVICE MASTER table above, but for line-item charges
-- (delivery, service, documentation, ...) rather than orderable services.
-- =========================================

CREATE TABLE IF NOT EXISTS charge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    charge_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,

    status BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO charge (charge_name) VALUES
    ('Delivery Charge'), ('Service Charge'), ('Documentation Charge')
ON CONFLICT (charge_name) DO NOTHING;

-- Corrects a prior migration that deactivated 'Delivery Charge' here to hide
-- it from the org-wide Charges panel. Superseded by the generic per-service
-- ORGANIZATION SERVICE CHARGE PRICING mechanism below, which assigns charge
-- types (including this one) to specific services instead — that mechanism
-- needs 'Delivery Charge' active in this master to be selectable at all.
-- Only corrects environments where the old migration already ran (condition
-- never matches on a fresh install, where the column default already left
-- it true) — safe to re-run.
UPDATE charge SET status = true, updated_at = now()
WHERE charge_name = 'Delivery Charge' AND status = false;


-- =========================================
-- ORGANIZATION WALLET
-- =========================================

CREATE TABLE IF NOT EXISTS organization_wallet (
    organization_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    balance NUMERIC(12,2) NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Reserved-but-not-yet-spent money: set aside by _block_wallet_amount the
-- moment a stamp-value order is placed, moved back out (never touching
-- `balance`) by _release_wallet_block on cancel or by _convert_block_to_debit
-- once the order actually completes. Available balance for any new
-- block/debit check is always `balance - blocked_amount`, never `balance`
-- alone — see partner._block_wallet_amount.
ALTER TABLE organization_wallet ADD COLUMN IF NOT EXISTS blocked_amount NUMERIC(12,2) NOT NULL DEFAULT 0;


-- =========================================
-- WALLET TRANSACTIONS
-- =========================================

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    type VARCHAR(10) NOT NULL
        CHECK (
            type IN ('credit', 'debit')
        ),

    amount NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL,

    description TEXT,

    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- ORGANIZATION USER WALLET
-- =========================================

CREATE TABLE IF NOT EXISTS organization_user_wallet (
    organization_user_id UUID PRIMARY KEY
        REFERENCES organization_users(id)
        ON DELETE CASCADE,

    balance NUMERIC(12,2) NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Same reservation concept as organization_wallet.blocked_amount, for a
-- member's own wallet.
ALTER TABLE organization_user_wallet ADD COLUMN IF NOT EXISTS blocked_amount NUMERIC(12,2) NOT NULL DEFAULT 0;


-- =========================================
-- ORGANIZATION USER WALLET TRANSACTIONS
-- =========================================

CREATE TABLE IF NOT EXISTS organization_user_wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_user_id UUID NOT NULL
        REFERENCES organization_users(id)
        ON DELETE CASCADE,

    type VARCHAR(10) NOT NULL
        CHECK (
            type IN ('credit', 'debit')
        ),

    amount NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL,

    description TEXT,

    created_at TIMESTAMPTZ DEFAULT now()
);


-- One-time cleanup: wallet_recharge_request was a two-step staging table
-- (Pending -> Completed) that gated the wallet balance itself behind an
-- admin confirmation step — reverted. A wallet recharge credits the wallet
-- immediately again (see organizations.create_wallet_transaction); only the
-- Reimbursement invoice is deferred behind a later explicit action (see
-- organizations.generate_wallet_transaction_invoice), derived as "Pending"
-- rather than stored (see invoice_service.list_invoices_for_user) — no
-- replacement table needed. Safe to re-run.
DROP TABLE IF EXISTS wallet_recharge_request;


-- =========================================
-- ORGANIZATION SERVICE PRICING (Manage Services)
-- =========================================

CREATE TABLE IF NOT EXISTS organization_service_pricing (
    id SERIAL PRIMARY KEY,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    service_name VARCHAR(100) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT false,
    price NUMERIC(10,2),

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (organization_id, service_name)
);

-- A prior migration briefly added a `delivery_charge` column directly here
-- (one hardcoded charge type per service, baked into a column). It was never
-- committed and held zero real data, and doesn't scale to arbitrary
-- admin-defined charge types — superseded by ORGANIZATION SERVICE CHARGE
-- PRICING below. Dropped rather than kept as dead weight.
ALTER TABLE organization_service_pricing DROP COLUMN IF EXISTS delivery_charge;


-- =========================================
-- ORGANIZATION SERVICE CHARGE PRICING (Manage Services > per-service
-- Additional Charges)
-- Generic mapping: organization + service + charge type (from the CHARGE
-- MASTER above) -> partner-specific amount. Lets Super Admin assign any
-- number of admin-defined charge types (Delivery Charge, Handling Charge, a
-- brand new "ABC Charge", ...) to a specific service, independently per
-- organization, without ever adding a new column for each charge type.
-- organization_service_pricing.price above (the Base/Service Price) is NOT
-- part of this table and is untouched by it — this table is only for the
-- additional, arbitrary, admin-defined charges layered on top of that base
-- price. service_name/charge_name are plain validated text (against
-- get_active_service_names()/get_active_charge_names()), same convention as
-- organization_service_pricing/organization_charge_pricing above rather than
-- FKs to service.id/charge.id.
-- =========================================

CREATE TABLE IF NOT EXISTS organization_service_charge_pricing (
    id SERIAL PRIMARY KEY,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    service_name VARCHAR(100) NOT NULL,
    charge_name VARCHAR(100) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT false,
    price NUMERIC(10,2),

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (organization_id, service_name, charge_name)
);

-- Lets any charge (in practice, only "Service Charge" via the admin UI) be
-- priced as either a flat amount (price, the pre-existing column — used as
-- the final charge as-is) or a percentage of the order's own face value
-- (percentage, floored at minimum_amount — see create_bulk_estamp_order in
-- backend/app/routes/partner.py for the authoritative calculation). Valid
-- values ('amount'/'percentage') are enforced by ServiceChargeItem in
-- organizations.py, not a DB CHECK constraint, since this is an additive
-- ALTER on an existing table and re-running schema.sql must stay idempotent.
-- Existing rows default to 'amount' with percentage/minimum_amount NULL —
-- behaviorally identical to before this column existed.
ALTER TABLE organization_service_charge_pricing ADD COLUMN IF NOT EXISTS calculation_type VARCHAR(20) NOT NULL DEFAULT 'amount';
ALTER TABLE organization_service_charge_pricing ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2);
ALTER TABLE organization_service_charge_pricing ADD COLUMN IF NOT EXISTS minimum_amount NUMERIC(10,2);

-- One-time additive backfill: any organization with an active legacy
-- org-wide Delivery Charge (organization_charge_pricing) gets an equivalent
-- eStamp Bulk-scoped row here, so their already-configured delivery pricing
-- keeps working under the new per-service model instead of silently
-- dropping to "not configured". ON CONFLICT DO NOTHING against the UNIQUE
-- constraint above makes this safe to run every time schema.sql is
-- re-applied — it can never create a duplicate, and it will never clobber a
-- value Super Admin has since edited through the new UI (the row already
-- exists by then, so the INSERT is simply a no-op). The legacy
-- organization_charge_pricing row itself is left completely untouched — not
-- deleted, not deactivated, not migrated.
INSERT INTO organization_service_charge_pricing (organization_id, service_name, charge_name, is_active, price)
SELECT organization_id, 'eStamp Bulk', 'Delivery Charge', true, price
FROM organization_charge_pricing
WHERE charge_name = 'Delivery Charge' AND is_active = true AND price IS NOT NULL
ON CONFLICT (organization_id, service_name, charge_name) DO NOTHING;

-- Same reasoning, for Manual eStamp: it originally priced every charge type
-- (not just Delivery Charge) from the legacy org-wide organization_charge_pricing
-- table (see create_manual_estamp_order in backend/app/routes/partner.py),
-- migrated to the per-service model so pricing lives in one place (the
-- "Additional Charges" panel under Manage Services) instead of two. Backfills
-- every active, priced charge type, not just Delivery Charge.
INSERT INTO organization_service_charge_pricing (organization_id, service_name, charge_name, is_active, price)
SELECT organization_id, 'Manual eStamp', charge_name, true, price
FROM organization_charge_pricing
WHERE is_active = true AND price IS NOT NULL
ON CONFLICT (organization_id, service_name, charge_name) DO NOTHING;


-- =========================================
-- ORDER CHARGE (snapshot)
-- One row per additional charge actually applied to an order at creation
-- time — copied from organization_service_charge_pricing at that moment,
-- same "snapshot once, never re-derive" reasoning as
-- b2b_estamp_bulk_order.service_fee/delivery_charge and
-- orders.esign_price_per_signer below/above (a later config change never
-- retroactively alters an already-placed order). Generic across every
-- service, not just eStamp Bulk, so a future service can start writing to
-- this table without a schema change.
-- =========================================

CREATE TABLE IF NOT EXISTS order_charge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL
        REFERENCES orders(id)
        ON DELETE CASCADE,

    charge_name VARCHAR(100) NOT NULL,
    price NUMERIC(10,2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_charge_order_id ON order_charge(order_id);


-- =========================================
-- ORGANIZATION SERVICE PRICE HISTORY (audit trail)
-- One row per price change (never updated in place); the latest row per
-- organization_id + service_name is the current price.
-- =========================================

CREATE TABLE IF NOT EXISTS organization_service_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    service_name VARCHAR(100) NOT NULL,
    price NUMERIC(10,2),

    changed_by UUID REFERENCES users(id),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- ORGANIZATION CHARGE PRICING (Manage Services — Charges panel)
-- Mirrors ORGANIZATION SERVICE PRICING above, but for charge line items
-- (Delivery/Service/Documentation Charge, plus any custom ones added from
-- the charge master). No history table — charges don't need a price audit
-- trail the way services do.
-- =========================================

CREATE TABLE IF NOT EXISTS organization_charge_pricing (
    id SERIAL PRIMARY KEY,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    charge_name VARCHAR(100) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT false,
    price NUMERIC(10,2),

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (organization_id, charge_name)
);


-- =========================================
-- ORGANIZATION DOCUMENT PRICING (Manage Services)
-- =========================================

CREATE TABLE IF NOT EXISTS organization_document_pricing (
    id SERIAL PRIMARY KEY,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    document_name VARCHAR(150) NOT NULL,
    price NUMERIC(10,2),

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (organization_id, document_name)
);


-- =========================================
-- ORGANIZATION DOCUMENT PRICE HISTORY (audit trail)
-- =========================================

CREATE TABLE IF NOT EXISTS organization_document_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    document_name VARCHAR(150) NOT NULL,
    price NUMERIC(10,2),

    changed_by UUID REFERENCES users(id),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- ORDERS (Reports)
-- Scaffolded for Order Reports. No order-creation flow exists yet;
-- rows will only appear once that module is built.
-- =========================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_no VARCHAR(50) UNIQUE NOT NULL,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    organization_user_id UUID
        REFERENCES organization_users(id)
        ON DELETE SET NULL,

    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_mobile VARCHAR(20),

    service_name VARCHAR(100),
    document_type VARCHAR(150),
    document_filename VARCHAR(255),
    document_path VARCHAR(500),

    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,

    -- Partner Portal Orders module statuses: Draft, Submitted, In Progress,
    -- Completed, Failed, Cancelled.
    status VARCHAR(50) NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_name VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS document_filename VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS document_path VARCHAR(500);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
-- Populated by Super Admin's Cancel Order action on Order Reports (see
-- reports.cancel_order_report) alongside status = 'Cancelled' — kept here
-- generically for audit rather than per-service, since any order type (not
-- just the stamp-value services that already had their own narrower cancel
-- flow) can now be cancelled with a reason this way.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
CREATE SEQUENCE IF NOT EXISTS orders_order_no_seq START 1;

-- Structured snapshot of whatever the customer entered on the Loan Document
-- flow (loan_type, language, loan_amount, tenure_months, plus loan-type-
-- specific fields like vehicle_make/property_address/farm_location) — see
-- LoanDocumentFlow.jsx. Previously this data only existed baked into the
-- generated PDF's text and in transient React state; NULL for every
-- non-loan order.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loan_details JSONB;

-- eStamp reimbursement wallet model — set true only when this order's real
-- stamp/denomination value was actually deducted from the wallet under the
-- new prefunded-wallet flow (see stamp_service.initiate_stamp and
-- partner.create_bulk_estamp_order). Defaults false so every existing order
-- keeps following the old behavior (full stamp duty recovered later via a
-- per-order Reimbursement invoice — see app/invoice_service.py) without any
-- backfill. A single common column on `orders` rather than duplicated on
-- b2b_stamp_transaction/b2b_estamp_bulk_order, since both eStamp order types
-- already have a row here.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stamp_value_wallet_debited BOOLEAN NOT NULL DEFAULT false;

-- Same guard, same reasoning, for eKYC's fee: only ever debited once
-- verification lands on a real outcome (Verified/Document Extracted — see
-- ekyc_service._charge_ekyc_fee_on_verification), never at order placement.
-- Defaults false so every existing eKYC order keeps the old behavior
-- (invoice-only, no wallet) unless it's re-verified after this ships.
-- Superseded by service_charge_wallet_debited below (eKYC's fee is no
-- longer special-cased — it goes through the same universal
-- Generate-Invoice-triggered deduction every other service charge does, see
-- invoice_service.get_or_create_invoice_for_order's charge_wallet param).
-- Left in place rather than dropped — no destructive migration for a column
-- that's simply unused going forward.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ekyc_fee_wallet_debited BOOLEAN NOT NULL DEFAULT false;

-- How much of this order's stamp/denomination value is currently reserved
-- ("blocked") against the wallet — set by partner._block_wallet_amount the
-- moment a stamp-value order (eStamp Bulk/Manual eStamp/single eStamp) is
-- placed (or, for single eStamp, when initiate_stamp is called — the real
-- amount isn't known at plain order creation for that service). Zeroed by
-- _release_wallet_block (order cancelled) or _convert_block_to_debit (order
-- Completed — the moment this becomes a real stamp_value_wallet_debited
-- debit instead). Never sums with the org/member wallet's own blocked_amount
-- directly — this is just this one order's contribution to that total, kept
-- so a release/convert always knows the exact figure to reverse.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_blocked_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Independent from wallet_blocked_amount above (that one's exclusively the
-- eStamp/Manual eStamp stamp-duty face-value block) — a combo order (eSign
-- attached to a stamp order) needs to reserve for BOTH purposes at once
-- without either clobbering the other's bookkeeping (partner._block_wallet_
-- amount overwrites, not adds, whatever column it's pointed at). Blocked in
-- full (price_per_signer x signer count) the moment esign_service.initiate_
-- esign actually dispatches invitations; each signer's own share is peeled
-- off individually as THEY sign (_apply_signer_status ->
-- partner._convert_partial_block_to_debit) — unlike wallet_blocked_amount,
-- which is always released/converted in one all-or-nothing shot.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS esign_wallet_blocked_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Guards the service-charge (non-stamp-value) wallet deduction — set true
-- the one time invoice_service.get_or_create_invoice_for_order actually
-- creates this order's "Invoice"-type row with charge_wallet=True (Super
-- Admin's Generate Invoice action, manual or auto-triggered on completion —
-- never the Partner User's own Download Invoice click). A repeat Generate
-- Invoice click, or a repeat completion-hook call, is a no-op because of
-- this flag — same exactly-once-debit pattern as stamp_value_wallet_debited.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_charge_wallet_debited BOOLEAN NOT NULL DEFAULT false;

-- Optionally tags a wallet top-up (wallet_transactions / see below) as having
-- been credited specifically to fund a short balance on this order — e.g. an
-- eStamp Bulk order whose face value exceeds the partner's current balance,
-- where Super Admin tops up the wallet by exactly the shortfall before
-- marking the order Completed. NULL for the common case of a wallet credit
-- that's just a general recharge, unrelated to any specific order. Declared
-- here (after `orders` exists) rather than inline on wallet_transactions'
-- own CREATE TABLE below, which runs earlier in this file.
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE organization_user_wallet_transactions ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_order_id ON wallet_transactions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_user_wallet_transactions_order_id ON organization_user_wallet_transactions(order_id) WHERE order_id IS NOT NULL;


-- =========================================
-- ESIGN (SignDesk integration) — triggered from the "eSign" service's
-- Create Order flow. One b2b_esign_transaction per order (the docket sent to
-- SignDesk), one b2b_esign_signer row per signer on that docket.
--
-- Named with a b2b_ prefix (rather than the more obvious esign_transaction /
-- user_esign) because this Postgres database is shared with a separate,
-- pre-existing B2C application that already owns tables with those exact
-- names (integer-keyed, unrelated schema) — CREATE TABLE IF NOT EXISTS would
-- have silently no-opped against them instead of creating the B2B tables.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_esign_transaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    reference_id VARCHAR(150) UNIQUE NOT NULL,
    docket_id VARCHAR(150),
    document_id VARCHAR(150),

    -- initiated / sent / signed / failed
    status VARCHAR(50) NOT NULL DEFAULT 'initiated',

    raw_response JSONB,
    signed_file_path VARCHAR(500),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS b2b_esign_signer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL
        REFERENCES orders(id)
        ON DELETE CASCADE,

    signer_name VARCHAR(255) NOT NULL,
    signer_email VARCHAR(255) NOT NULL,
    signer_mobile VARCHAR(20) NOT NULL,

    -- pending / sent / signed / rejected / expired / failed
    status VARCHAR(50) NOT NULL DEFAULT 'pending',

    signdesk_signer_ref_id VARCHAR(150),
    signdesk_signer_id VARCHAR(150),
    signdesk_document_id VARCHAR(150),
    invitation_link TEXT,

    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_esign_signer_order_id ON b2b_esign_signer(order_id);
CREATE INDEX IF NOT EXISTS idx_b2b_esign_signer_signdesk_ids ON b2b_esign_signer(signdesk_document_id, signdesk_signer_id);

-- Signing order (sent to SignDesk at initiate time, now also persisted for
-- display); best-effort activity fields SignDesk's callback may or may not
-- ever actually populate (stay NULL if it doesn't — the UI shows "—");
-- wallet_debited/raw_callback_payload support per-signature billing below.
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS sequence INTEGER;
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS device_info TEXT;
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS raw_callback_payload JSONB;
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS wallet_debited BOOLEAN NOT NULL DEFAULT false;

-- Per-signer price locked in at order-creation time (immune to later pricing
-- changes) so each completed signature can be billed individually instead of
-- charging the full price × signer count upfront.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS esign_price_per_signer NUMERIC(10,2);

-- Every raw SignDesk callback, kept for audit/debugging regardless of
-- whether it matched a known signer — the per-signer table above only ever
-- holds the latest one.
CREATE TABLE IF NOT EXISTS b2b_esign_callback_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    signer_id UUID REFERENCES b2b_esign_signer(id) ON DELETE SET NULL,

    signdesk_document_id VARCHAR(150),
    signdesk_signer_id VARCHAR(150),

    payload JSONB NOT NULL,

    received_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_esign_callback_log_order_id ON b2b_esign_callback_log(order_id);

-- Workflow versioning: editing signer details before anyone has signed
-- supersedes the current transaction with a brand new one (new SignDesk
-- docket) rather than mutating it in place — the old row/signers stay for
-- history, just marked inactive, so an old email link's webhook callback can
-- be detected and ignored (see esign_service.record_callback) instead of
-- updating status or billing on a workflow nobody should trust anymore.
ALTER TABLE b2b_esign_transaction DROP CONSTRAINT IF EXISTS b2b_esign_transaction_order_id_key;
ALTER TABLE b2b_esign_transaction ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE b2b_esign_transaction ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE b2b_esign_transaction ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE b2b_esign_transaction ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Enforces "only the latest version is active" at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_esign_transaction_one_active_per_order
    ON b2b_esign_transaction(order_id) WHERE is_active;

-- Which workflow version each signer row belongs to — old rows keep their
-- transaction_id pointing at the now-inactive version instead of being
-- reused, so history and in-flight status can never mix.
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES b2b_esign_transaction(id) ON DELETE CASCADE;
UPDATE b2b_esign_signer s SET transaction_id = t.id
    FROM b2b_esign_transaction t WHERE t.order_id = s.order_id AND s.transaction_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_esign_signer_transaction_id ON b2b_esign_signer(transaction_id);

-- status comment widens further: pending / sent / signed / rejected / expired
-- / failed / cancelled — 'cancelled' is set on any still-pending signer when
-- their workflow is cancelled outright or superseded by an edit, so the
-- timeline never shows a stale "Pending" for a link that no longer works.
ALTER TABLE b2b_esign_signer ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;


-- =========================================
-- ESTAMP (SignDesk DSS 2.0 Stamp Request API integration) — triggered from
-- the "eStamp" service's Create Order flow. One row per order (no
-- versioning/supersede like eSign — a stamp request either succeeds, fails,
-- or is still processing at SignDesk, so a retry just overwrites this row).
-- Same b2b_ prefix reasoning as the eSign tables above.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_stamp_transaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    reference_id VARCHAR(150) UNIQUE NOT NULL,
    signdesk_transaction_id VARCHAR(150),
    signdesk_order_id VARCHAR(150),

    stamp_state VARCHAR(10) NOT NULL,
    document_category INTEGER NOT NULL,
    stamp_amount NUMERIC(12,2) NOT NULL,
    consideration_amount NUMERIC(14,2),

    -- processing / completed / failed
    status VARCHAR(50) NOT NULL DEFAULT 'processing',

    stamp_paper_number TEXT,
    stamp_duty_amount NUMERIC(12,2),

    error_code VARCHAR(50),
    error_message TEXT,
    raw_response JSONB,
    stamped_file_path VARCHAR(500),

    -- Only ever set for "eStamp On The Fly" orders (service_name = 'eStamp
    -- On The Fly') — the Karnataka article code the client picked from
    -- karnataka_article_codes.py's closed list, snapshotted here purely for
    -- our own audit/reporting trail. NULL for plain "eStamp" orders. Not a
    -- documented DSS 2.0 request field — see stamp_service._build_request_
    -- payload_otf's comment for why this isn't sent to SignDesk as-is.
    article_number VARCHAR(20),
    digital_article_code VARCHAR(20),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_stamp_transaction_order_id ON b2b_stamp_transaction(order_id);

-- Additive migration for installs whose b2b_stamp_transaction predates the
-- eStamp On The Fly columns above — safe to re-run, matches this file's
-- existing ALTER-TABLE-IF-NOT-EXISTS convention (see stamp_value_wallet_debited above).
ALTER TABLE b2b_stamp_transaction ADD COLUMN IF NOT EXISTS article_number VARCHAR(20);
ALTER TABLE b2b_stamp_transaction ADD COLUMN IF NOT EXISTS digital_article_code VARCHAR(20);


-- =========================================
-- ESTAMP BULK — a separate, internally-processed service (NO SignDesk
-- integration, unlike b2b_stamp_transaction above): a partner requests a
-- batch of blank physical stamp papers across one or more denominations for
-- a state, always delivered physically. One order (orders.service_name =
-- 'eStamp Bulk') has exactly one satellite row here (1:1, same shape as
-- b2b_stamp_transaction) plus one or more item rows below (1:N, mirrors
-- b2b_esign_signer's parent-of-order pattern) — one per denomination
-- selected.
--
-- total_face_value/service_fee/delivery_charge are all snapshotted here at
-- order-creation time (same reasoning as orders.esign_price_per_signer) so
-- later pricing changes never retroactively alter an already-placed order.
-- Delivery address is plain columns, not JSON — this is always exactly one
-- address per order, not a repeating list, so it doesn't need its own table
-- the way the denomination rows do.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_estamp_bulk_order (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    stamp_state_id UUID NOT NULL
        REFERENCES state(id),

    total_quantity INTEGER NOT NULL,
    total_face_value NUMERIC(12,2) NOT NULL,
    service_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0,

    delivery_full_name VARCHAR(255) NOT NULL,
    delivery_mobile VARCHAR(20) NOT NULL,
    delivery_address_line1 VARCHAR(255) NOT NULL,
    delivery_address_line2 VARCHAR(255),
    delivery_city VARCHAR(100) NOT NULL,
    delivery_state VARCHAR(100) NOT NULL,
    delivery_pincode VARCHAR(10) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_estamp_bulk_order_order_id ON b2b_estamp_bulk_order(order_id);

-- Set when Super Admin manually marks the order "Delivered" after the vendor
-- confirms physical delivery (see partner.update_bulk_estamp_order_status /
-- BULK_ESTAMP_STATUS_FLOW). NULL for every order that hasn't reached that
-- status yet, including all pre-existing rows.
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Stamp party details — every eStamp Bulk order names a First Party and a
-- Second Party, exactly one of which is always the ordering Partner
-- (enforced server-side in partner.create_bulk_estamp_order, which derives
-- that party's name/address from the authenticated organization rather than
-- accepting it from the client at all — only the OTHER party's details are
-- ever client-supplied). paying_party records which of the two is
-- responsible for the stamp/service charges, independent of which one is
-- the Partner. Nullable — NULL for every order placed before this existed.
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS first_party_name VARCHAR(255);
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS first_party_address TEXT;
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS second_party_name VARCHAR(255);
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS second_party_address TEXT;
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS paying_party VARCHAR(10)
    CHECK (paying_party IN ('first', 'second'));

-- =========================================
-- ORGANIZATION ESTAMP BULK PRICING RULES
--
-- Super Admin-configured, per-partner tiered pricing for eStamp Bulk: an
-- additional charge (on top of whatever "Service Charge"/other charges are
-- already assigned via organization_service_charge_pricing — see
-- Quotation.jsx) selected by matching a stamp denomination + quantity to a
-- rule's [denomination_from, denomination_to] x [quantity_from, quantity_to]
-- range. quantity_to NULL means unlimited (no upper bound). Every number
-- here is admin-entered — nothing about the ranges or the charge is
-- hardcoded (see partner.create_bulk_estamp_order, which looks up the
-- matching rule per denomination row at order-creation time and snapshots
-- the result into order_charge, exactly like every other additional
-- charge). Overlap validation (same organization, both active) is enforced
-- in organizations.py at create/update time, not by a DB constraint — a 2D
-- range-overlap check isn't expressible as a simple CHECK/EXCLUDE without
-- the btree_gist extension this project doesn't otherwise need.
-- =========================================

CREATE TABLE IF NOT EXISTS organization_estamp_bulk_pricing_rule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    -- denomination_to NULL means "no upper bound" — only valid when
    -- denomination_type = 'any' (denomination_from is then forced to 0 by
    -- organizations.BulkEstampPricingRuleIn), exactly mirroring how
    -- quantity_to NULL already means "unlimited" below.
    denomination_from NUMERIC(12,2) NOT NULL,
    denomination_to NUMERIC(12,2),
    quantity_from INTEGER NOT NULL,
    quantity_to INTEGER,

    charge NUMERIC(12,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CHECK (denomination_to IS NULL OR denomination_from <= denomination_to),
    CHECK (quantity_to IS NULL OR quantity_from <= quantity_to),
    CHECK (quantity_from >= 1),
    CHECK (charge >= 0)
);

CREATE INDEX IF NOT EXISTS idx_org_estamp_bulk_pricing_rule_org_id
    ON organization_estamp_bulk_pricing_rule(organization_id);

-- `charge` is a rate, not a flat total — its meaning depends on charge_type:
-- 'fixed_amount' -> a ₹ amount per stamp (line service charge = charge x
-- quantity); 'percentage' -> a percentage of the denomination per stamp
-- (line service charge = denomination x charge/100 x quantity). See
-- partner.calculate_bulk_estamp_line_charge, which is the ONLY place this
-- formula lives — kept deliberately isolated so it stays a one-line change
-- if the business ever needs a different formula. Percentage's sensible
-- range (0-100) is validated in organizations.BulkEstampPricingRuleIn, not
-- here, to avoid a cross-column CHECK's migration complexity for a
-- non-critical guard.
ALTER TABLE organization_estamp_bulk_pricing_rule ADD COLUMN IF NOT EXISTS charge_type VARCHAR(20)
    NOT NULL DEFAULT 'fixed_amount' CHECK (charge_type IN ('fixed_amount', 'percentage'));

-- 'any' rules are open-ended (denomination_to = NULL / Infinity) but NOT
-- unconditional — Super Admin still enters denomination_from, so 'any'
-- means [denomination_from, Infinity), never [0, Infinity); added so Super
-- Admin isn't forced to guess/enter an artificial upper bound for a rate
-- meant to apply from some starting denomination upward. 'customize' is the
-- original bounded-range behavior, unchanged. Precedence
-- when both exist for the same quantity band: a matching 'customize' rule
-- always wins over an 'any' rule (see
-- partner._match_bulk_estamp_pricing_rule) — so the two types are
-- deliberately NOT treated as overlapping/conflicting with each other in
-- organizations._check_no_overlap; only same-type overlaps are rejected.
ALTER TABLE organization_estamp_bulk_pricing_rule ADD COLUMN IF NOT EXISTS denomination_type VARCHAR(20)
    NOT NULL DEFAULT 'customize' CHECK (denomination_type IN ('any', 'customize'));

-- Migration for databases created before denomination_to became nullable
-- (see the CREATE TABLE above) — safe/idempotent to re-run: DROP NOT NULL
-- is a no-op if the column is already nullable, and the DO block only fires
-- if the old strict (non-nullable-aware) CHECK is still present.
ALTER TABLE organization_estamp_bulk_pricing_rule ALTER COLUMN denomination_to DROP NOT NULL;

DO $$
DECLARE
    old_check_name text;
BEGIN
    SELECT conname INTO old_check_name
    FROM pg_constraint
    WHERE conrelid = 'organization_estamp_bulk_pricing_rule'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%denomination_from%denomination_to%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%IS NULL%';
    IF old_check_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE organization_estamp_bulk_pricing_rule DROP CONSTRAINT %I', old_check_name);
        ALTER TABLE organization_estamp_bulk_pricing_rule
            ADD CONSTRAINT organization_estamp_bulk_pricing_rule_denom_range_check
            CHECK (denomination_to IS NULL OR denomination_from <= denomination_to);
    END IF;
END $$;

-- =========================================
-- STATE STAMP PAPER TYPE CONFIGURATION
--
-- `state` is reference data owned by the pre-existing B2C application (never
-- CREATE TABLE'd in this file, only read — see catalog.py) — a satellite
-- table here, not an ALTER on `state` itself, same reasoning as
-- b2b_esign_transaction's naming-collision comment above. One row per state
-- that Super Admin has explicitly configured; a state with NO row here is
-- treated as 'Traditional Stamp Paper' by default (see
-- catalog.list_states) so every state that predates this feature keeps
-- working completely unchanged rather than silently blocking orders.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_state_stamp_config (
    state_id UUID PRIMARY KEY REFERENCES state(id) ON DELETE CASCADE,

    stamp_paper_type VARCHAR(30) NOT NULL
        CHECK (stamp_paper_type IN ('Traditional Stamp Paper', 'eStamp')),

    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Admin-added custom Stamp Paper Type *names* (beyond the two built-in,
-- functional ones above). A state can be configured with one of these, but
-- no order-creation flow exists for them yet — see
-- PartnerUserCreateEstampBulk.jsx and partner.create_bulk_estamp_order,
-- both of which show/return "coming soon" for any type that isn't one of
-- the two built-ins, rather than silently treating it as Traditional. This
-- table exists purely so a custom name is remembered and reappears in the
-- "Stamp Paper Type" list next time, without inventing real business logic
-- for it — see catalog.py's stamp-paper-types endpoints.
CREATE TABLE IF NOT EXISTS b2b_custom_stamp_paper_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Widened (was 30) and the built-in-only CHECK dropped so a state can be
-- set to a custom name from the table above, not just the two hardcoded
-- ones — order creation itself independently still only works for the two
-- built-ins (blocked server-side in partner.py regardless of what this
-- column holds), so this only affects what a state's *label* can be.
ALTER TABLE b2b_state_stamp_config ALTER COLUMN stamp_paper_type TYPE VARCHAR(50);
ALTER TABLE b2b_state_stamp_config DROP CONSTRAINT IF EXISTS b2b_state_stamp_config_stamp_paper_type_check;

-- =========================================
-- ARTICLE CODE MASTER
--
-- Super Admin-configured list an eStamp-type Bulk order's Article Code field
-- is chosen from (see partner_user.BulkEstampOrderCreate) — same shape/CRUD
-- pattern as the `charge` master (see app/routes/charges.py), deliberately
-- NOT seeded with any values: the real Article Code list is provided
-- separately (see backend/app/routes/article_codes.py).
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_article_code (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    article_code VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- State-wise Article Codes (see app/routes/article_codes.py) — the same
-- article code (e.g. "10") can mean a different article under a different
-- state's Stamp Act, so uniqueness is per-state, not global. NULL only for
-- rows that existed before this column was added: they predate state-wise
-- configuration and can't be reliably mapped to one state after the fact
-- (Super Admin must open each one and pick a state — see ArticleCodeMaster.jsx
-- filtering "Unassigned" separately), so they're left unassigned rather than
-- guessed. Every row created from here on always has one (see
-- ArticleCodeCreate.state_id being required) and is excluded from an
-- eStamp Bulk order's per-state dropdown until a state is set (see
-- get_active_article_codes).
ALTER TABLE b2b_article_code ADD COLUMN IF NOT EXISTS state_id UUID REFERENCES state(id) ON DELETE RESTRICT;

-- Replaces the old global UNIQUE(article_code) above — an Article Code now
-- only has to be unique within its own state (Karnataka "10" and
-- Maharashtra "10" are both allowed; see article_codes.create_article_code).
-- Case-insensitive to match that same function's own lower()-based check.
-- Scoped to state_id IS NOT NULL: new rows always have a state, so this is
-- the only uniqueness that will ever be enforced going forward; the
-- unassigned legacy rows this migration leaves behind keep whatever
-- distinctness the dropped global constraint already gave them and can
-- never collide with a real, state-scoped row.
ALTER TABLE b2b_article_code DROP CONSTRAINT IF EXISTS b2b_article_code_article_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS b2b_article_code_state_code_unique
    ON b2b_article_code (state_id, lower(article_code))
    WHERE state_id IS NOT NULL;

-- One-time backfill for every row that predates the state_id column above:
-- every Article Code entered so far was entered under the Karnataka Stamp
-- Act specifically — several of their own descriptions name Karnataka-only
-- bodies (BBMP, UDA, BMRDA), not a generic pan-India schedule, so this is a
-- reliable read of the existing data rather than a guess. Only ever touches
-- rows still NULL, so re-running this script is always a no-op afterwards
-- and can never clobber a state Super Admin later sets on any row.
UPDATE b2b_article_code
SET state_id = (SELECT id FROM state WHERE state_name = 'Karnataka')
WHERE state_id IS NULL
  AND EXISTS (SELECT 1 FROM state WHERE state_name = 'Karnataka');

-- eStamp-type Bulk order fields — consideration_amount/article_code_id are
-- only ever set for an order whose state resolved to 'eStamp' at creation
-- (see partner.create_bulk_estamp_order); both stay NULL for every
-- Traditional Stamp Paper order, unchanged from before this feature.
-- stamp_paper_type freezes what the state's config actually was AT ORDER
-- TIME — a later Super Admin config change must never retroactively alter
-- how an already-placed order is displayed or processed, same snapshot
-- reasoning as delivery_charge_compat/service_fee elsewhere on this table.
-- For an eStamp order, total_quantity/total_face_value start at 0 (nothing
-- known yet — no item row exists) and are recomputed the moment Admin adds
-- the denomination via b2b_estamp_bulk_order_item (see
-- partner.add_bulk_estamp_denomination) — the exact same columns and the
-- exact same downstream pricing/invoice code Traditional orders already use,
-- not a parallel path.
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS stamp_paper_type VARCHAR(30)
    NOT NULL DEFAULT 'Traditional Stamp Paper'
    CHECK (stamp_paper_type IN ('Traditional Stamp Paper', 'eStamp'));
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS consideration_amount NUMERIC(14,2);
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS article_code_id UUID REFERENCES b2b_article_code(id) ON DELETE SET NULL;

-- Stamp Number / certificate number of the physical stamp paper actually
-- procured for this order — Super Admin is required to enter it in a popup
-- at the moment they mark the order Completed (see
-- partner.update_bulk_estamp_order_status), so it's always populated by the
-- time an order reaches that status. NULL for every order completed before
-- this existed.
ALTER TABLE b2b_estamp_bulk_order ADD COLUMN IF NOT EXISTS stamp_number VARCHAR(100);

-- One row per denomination selected on the order — e.g. ₹100 x 20, ₹200 x 10.
-- denomination/face_value are frozen at order time (not re-derived from
-- stamp_denomination_id later); stamp_denomination_id is kept for traceability
-- back to the B2B STAMP DENOMINATION master but is nullable/SET NULL since a
-- master row could be deactivated or edited long after this order shipped.
CREATE TABLE IF NOT EXISTS b2b_estamp_bulk_order_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL
        REFERENCES orders(id)
        ON DELETE CASCADE,

    stamp_denomination_id UUID
        REFERENCES b2b_stamp_denomination(id)
        ON DELETE SET NULL,

    denomination NUMERIC(10,2) NOT NULL,
    quantity INTEGER NOT NULL,
    face_value NUMERIC(12,2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_estamp_bulk_order_item_order_id ON b2b_estamp_bulk_order_item(order_id);

-- Snapshot of which Bulk eStamp Pricing rule (and what it resolved to)
-- actually priced this denomination line — frozen at the moment the line was
-- added (order creation for Traditional Stamp Paper, add_bulk_estamp_
-- denomination for eStamp — see partner.py), so a later change to the rule,
-- or the rule being deleted, never retroactively alters what an existing
-- order shows or was charged. NULL for a line that matched no active rule
-- (service_charge stays 0 for it) and for every line that existed before
-- this feature.
ALTER TABLE b2b_estamp_bulk_order_item ADD COLUMN IF NOT EXISTS pricing_rule_id UUID
    REFERENCES organization_estamp_bulk_pricing_rule(id) ON DELETE SET NULL;
ALTER TABLE b2b_estamp_bulk_order_item ADD COLUMN IF NOT EXISTS charge_type VARCHAR(20);
ALTER TABLE b2b_estamp_bulk_order_item ADD COLUMN IF NOT EXISTS rate NUMERIC(12,4);
ALTER TABLE b2b_estamp_bulk_order_item ADD COLUMN IF NOT EXISTS service_charge NUMERIC(12,2);


-- =========================================
-- EKYC (SignDesk General Document Verification API integration) —
-- triggered from the "eKYC" service's Create Order flow. One row per order,
-- same one-shot-request shape as b2b_esign_transaction above (no per-signer
-- fan-out needed here, so no second table). Same b2b_ prefix reasoning as
-- the eSign tables above.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_ekyc_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    reference_id VARCHAR(150) UNIQUE NOT NULL,
    doc_type VARCHAR(50) NOT NULL,
    verification_requested BOOLEAN NOT NULL DEFAULT true,

    -- initiated / success / failed
    status VARCHAR(50) NOT NULL DEFAULT 'initiated',
    verified BOOLEAN,

    extracted_data JSONB,
    raw_response JSONB,
    error TEXT,
    error_code VARCHAR(50),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_ekyc_verification_order_id ON b2b_ekyc_verification(order_id);


-- =========================================
-- BULK EKYC (CSV import) — a data-entry convenience layered on top of the
-- eKYC flow above, never a separate priced service or a duplicate of its
-- logic. One batch per CSV upload; one record per customer row in that CSV.
-- A record's status is deliberately NOT stored here — it's derived at read
-- time from its linked orders/b2b_ekyc_verification row (order_id NULL =
-- Not Initiated; else mapped from that order's real, already-synced status
-- — see partner_user.py's _ekyc_bulk_record_status), so it can never drift
-- out of sync with the actual eKYC order. order_id is set atomically inside
-- the SAME transaction that creates the real order (see
-- partner._create_order's bulk_ekyc_record_id param) — a record is either
-- linked to a real order or it isn't, never partially.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_ekyc_bulk_batch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,
    organization_user_id UUID
        REFERENCES organization_users(id)
        ON DELETE SET NULL,

    filename VARCHAR(255),
    total_rows INTEGER NOT NULL DEFAULT 0,
    imported_rows INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT now()
);

-- id is this record's stable identity — the row a status update/Action
-- click keys off, never customer_name/mobile/email (which can collide or
-- change across re-imports).
CREATE TABLE IF NOT EXISTS b2b_ekyc_bulk_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    batch_id UUID NOT NULL
        REFERENCES b2b_ekyc_bulk_batch(id)
        ON DELETE CASCADE,
    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,
    organization_user_id UUID
        REFERENCES organization_users(id)
        ON DELETE SET NULL,

    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),   -- NULL — not collected on the Download Template; filled in manually at Initiate eKYC time if needed (see doc_type below)
    customer_mobile VARCHAR(20) NOT NULL,
    doc_type VARCHAR(50),   -- 'aadhaar_card' | 'pan_card' | NULL (picked manually at Initiate eKYC time)
    account_number VARCHAR(50),   -- free-text reference only, never used by the eKYC verification call itself

    -- NULL = Not Initiated. Set exactly once, atomically, when Initiate
    -- eKYC actually creates the real order — see partner._create_order.
    order_id UUID
        REFERENCES orders(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE b2b_ekyc_bulk_record ALTER COLUMN customer_email DROP NOT NULL;
ALTER TABLE b2b_ekyc_bulk_record ADD COLUMN IF NOT EXISTS account_number VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_ekyc_bulk_record_org ON b2b_ekyc_bulk_record(organization_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_bulk_record_batch ON b2b_ekyc_bulk_record(batch_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_bulk_record_order ON b2b_ekyc_bulk_record(order_id);


-- =========================================
-- DIGILOCKER (SignDesk DigiLocker API integration) — triggered from the
-- "eKYC" service's order result screen as an alternative to the General
-- Document Verification upload flow above. One row per order.
--
-- transaction_id arrives in the SAME response as the login link (Generate
-- DigiLocker URL API), not after the user completes DigiLocker auth — the
-- Get Aadhaar Details step reuses it from here.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_digilocker_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    reference_id VARCHAR(150) UNIQUE NOT NULL,
    transaction_id VARCHAR(150),
    link TEXT,

    -- initiated / link_generated / verified / failed
    status VARCHAR(50) NOT NULL DEFAULT 'initiated',

    raw_response JSONB,
    error TEXT,
    error_code VARCHAR(50),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Get Aadhaar Details result. aadhaar_data deliberately never contains the
-- "uid" (full Aadhaar number) or "xml_file" (DigiLocker's raw offline XML,
-- which itself embeds the Aadhaar number) fields SignDesk's response
-- includes — see digilocker_service.fetch_aadhaar_details, which redacts
-- both before this column is written. UIDAI/CCA compliance (Annexure 2 of
-- SignDesk's eSign API doc): "The Aadhaar Number should not be stored."
-- aadhaar_last4 is the only Aadhaar-identifying fragment kept, same
-- last-4-digits pattern already used for signer_validation_inputs elsewhere.
ALTER TABLE b2b_digilocker_verification ADD COLUMN IF NOT EXISTS aadhaar_data JSONB;
ALTER TABLE b2b_digilocker_verification ADD COLUMN IF NOT EXISTS aadhaar_last4 VARCHAR(4);
ALTER TABLE b2b_digilocker_verification ADD COLUMN IF NOT EXISTS aadhaar_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_b2b_digilocker_verification_order_id ON b2b_digilocker_verification(order_id);


-- =========================================
-- PAN VERIFICATION (SignDesk's dedicated PAN Verification API) — triggered
-- from the "eKYC" service's order result screen for pan_card orders only, as
-- an additional government cross-check beyond the General Document
-- Verification upload flow above (which only OCR-extracts the card, it
-- doesn't validate against government PAN records). One row per order.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_pan_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    reference_id VARCHAR(150) UNIQUE NOT NULL,
    transaction_id VARCHAR(150),

    -- initiated / verified / failed
    status VARCHAR(50) NOT NULL DEFAULT 'initiated',
    valid_pan BOOLEAN,

    extracted_data JSONB,
    validated_data JSONB,
    data_match JSONB,
    data_match_aggregate VARCHAR(50),

    raw_response JSONB,
    error TEXT,
    error_code VARCHAR(50),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_pan_verification_order_id ON b2b_pan_verification(order_id);


-- =========================================
-- SBTR / CHALLAN RECORDS (Reports)
-- Scaffolded for SBTR/Challan Reports. Same caveat as orders above.
-- =========================================

CREATE TABLE IF NOT EXISTS sbtr_challans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    gtn_number VARCHAR(100),
    challan_number VARCHAR(100),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    organization_user_id UUID
        REFERENCES organization_users(id)
        ON DELETE SET NULL,

    customer_name VARCHAR(255),
    address TEXT,
    state_id UUID REFERENCES state(id),

    status VARCHAR(50) NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- ORGANIZATION DOCUMENT CONFIG (per PARTNER + STATE + DOCUMENT)
-- "Document Service" is a Service Master entry (organization_service_pricing
-- gates per-partner access to it, same as any other service). This table is
-- the actual partner-facing config that backs it — a partner only sees/sells
-- the specific documents an admin has enabled for them, per state, each with
-- its own base price, language support, and eStamp/eSign/eNotary add-on
-- pricing. Document types are NOT owned by B2B — doc_id references the
-- existing shared B2C `document` table. Whether eStamp/eSign/eNotary are
-- AVAILABLE at all for a doc+state is read live from the shared B2C
-- `doc_state_config` table (esign_price/notary_price/stamp_denominations,
-- managed by the B2C admin panel) — the *_price columns here are B2B's own
-- partner-specific price for whichever of those B2C has enabled.
-- =========================================

CREATE TABLE IF NOT EXISTS organization_document_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    state_id UUID NOT NULL REFERENCES state(id),
    doc_id UUID NOT NULL REFERENCES document(doc_id),

    base_price NUMERIC(10,2),
    multi_language_enabled BOOLEAN NOT NULL DEFAULT false,
    available_languages TEXT[],

    estamp_price NUMERIC(10,2),
    esign_price NUMERIC(10,2),
    enotary_price NUMERIC(10,2),

    status BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (organization_id, state_id, doc_id)
);


-- =========================================
-- ORGANIZATION DOCUMENT CONFIG PRICE HISTORY (audit trail)
-- One row per price change per price_type ('base' | 'estamp' | 'esign' | 'enotary').
-- =========================================

CREATE TABLE IF NOT EXISTS organization_document_config_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    config_id UUID NOT NULL REFERENCES organization_document_config(id) ON DELETE CASCADE,
    price_type VARCHAR(20) NOT NULL,
    price NUMERIC(10,2),

    changed_by UUID REFERENCES users(id),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- PARTNER USER SERVICES (per-user service assignment)
-- A Partner restricts which of the services/documents Super Admin already
-- assigned to THEM each of their own organization_users (Cyber Shops) may
-- use. Pure references — no service name, price, or document metadata is
-- duplicated here; exactly one of the two FK columns is set per row.
-- =========================================

CREATE TABLE IF NOT EXISTS partner_user_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_user_id UUID NOT NULL
        REFERENCES organization_users(id)
        ON DELETE CASCADE,

    service_pricing_id INTEGER
        REFERENCES organization_service_pricing(id)
        ON DELETE CASCADE,

    document_config_id UUID
        REFERENCES organization_document_config(id)
        ON DELETE CASCADE,

    created_at TIMESTAMPTZ DEFAULT now(),

    CHECK (
        (service_pricing_id IS NOT NULL AND document_config_id IS NULL) OR
        (service_pricing_id IS NULL AND document_config_id IS NOT NULL)
    ),
    UNIQUE (organization_user_id, service_pricing_id),
    UNIQUE (organization_user_id, document_config_id)
);


-- =========================================
-- VENDORS
-- LegalDesk operational teams or third-party providers who fulfill physical/
-- operational services (Print & Delivery, Document Verification, etc.).
-- Distinct from `organizations` (Partners, who sell to end customers) — a
-- Vendor is purely admin-managed, no self-service login/portal.
-- =========================================

CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vendor_name VARCHAR(255) NOT NULL,
    vendor_type VARCHAR(50) NOT NULL,   -- 'Internal Team' | 'Third-Party Vendor'

    contact_person VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile VARCHAR(20),
    gst_number VARCHAR(50),
    address TEXT,
    city VARCHAR(100),

    state_id UUID REFERENCES state(id),   -- vendor's own HQ location

    payment_mode VARCHAR(20) NOT NULL DEFAULT 'Wallet',   -- 'Wallet' | 'PPS'

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- VENDOR STATE ASSIGNMENTS (multi-select operational coverage)
-- =========================================

CREATE TABLE IF NOT EXISTS vendor_state_assignments (
    id SERIAL PRIMARY KEY,

    vendor_id UUID NOT NULL
        REFERENCES vendors(id)
        ON DELETE CASCADE,

    state_id UUID NOT NULL
        REFERENCES state(id),

    is_active BOOLEAN NOT NULL DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (vendor_id, state_id)
);


-- =========================================
-- VENDOR WALLET (exact clone of organization_wallet / wallet_transactions)
-- =========================================

CREATE TABLE IF NOT EXISTS vendor_wallet (
    vendor_id UUID PRIMARY KEY
        REFERENCES vendors(id)
        ON DELETE CASCADE,

    balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vendor_id UUID NOT NULL
        REFERENCES vendors(id)
        ON DELETE CASCADE,

    type VARCHAR(10) NOT NULL CHECK (type IN ('credit', 'debit')),
    amount NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL,
    description TEXT,

    created_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- VENDOR ORDER ASSIGNMENTS
-- Manual admin assignment of an existing order to a vendor for fulfillment.
-- A new join table rather than a vendor_id column on `orders` — orders has
-- no state_id today (vendor eligibility is state-based, orders' isn't), and
-- this keeps the already-active orders table/model untouched.
-- UNIQUE(order_id) = one current vendor per order; reassignment updates the
-- existing row instead of inserting a new one, keeping "current assignment"
-- unambiguous for reporting.
-- =========================================

CREATE TABLE IF NOT EXISTS vendor_order_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vendor_id UUID NOT NULL
        REFERENCES vendors(id)
        ON DELETE CASCADE,

    order_id UUID NOT NULL
        REFERENCES orders(id)
        ON DELETE CASCADE,

    state_id UUID REFERENCES state(id),
    service_name VARCHAR(100),
    notes TEXT,

    assigned_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (order_id)
);


-- =========================================
-- API CLIENTS
-- Companies authorized to call our external-facing APIs (eSign/eStamp/eKYC).
-- API ID/API Key generation is a separate follow-up step, not part of this
-- table yet — client identity/contact is established first.
-- =========================================

CREATE TABLE IF NOT EXISTS api_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile VARCHAR(20),

    callback_url TEXT,
    allowed_services TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],   -- 'eSign' | 'eStamp' | 'eKYC'

    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- api_id is DB-generated (sequence-backed, so it's collision-free without an
-- app round trip) and readable, e.g. LDAPI000001. api_key is generated by
-- the application (app/routes/api_clients.py) since it needs to be a
-- cryptographically random secret — the client never supplies either value.
CREATE SEQUENCE IF NOT EXISTS api_client_id_seq START WITH 1;

ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS api_id VARCHAR(20) UNIQUE
    DEFAULT ('LDAPI' || lpad(nextval('api_client_id_seq')::text, 6, '0'));
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS api_key VARCHAR(100) UNIQUE;

-- Backs the request_id (REQ000001, REQ000002, ...) every /api/v1/* call
-- returns — see app/routes/api_v1.py. A DB sequence rather than an in-memory
-- counter so it survives app restarts and stays unique across processes.
CREATE SEQUENCE IF NOT EXISTS api_request_id_seq START WITH 1;


-- =========================================
-- API TRANSACTIONS
-- One row per /api/v1/* call, written with status='pending' BEFORE the
-- SignDesk call that Step 7 adds — so a request is auditable (who called,
-- with what payload) even if that call times out or the process crashes
-- before it gets a response back.
-- =========================================

CREATE TABLE IF NOT EXISTS api_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    request_id VARCHAR(20) UNIQUE NOT NULL,
    api_client_id UUID NOT NULL REFERENCES api_clients(id),
    service VARCHAR(50) NOT NULL,   -- 'eSign' | 'eStamp' | 'eKYC'

    customer_reference_id VARCHAR(255),   -- reference_id the customer sent us, if any
    provider_reference_id VARCHAR(255),   -- SignDesk's reference_id/docket_id, filled in by Step 7

    -- 'pending' (written before the provider call) -> 'success' (provider
    -- accepted it — for eSign this means signing is IN PROGRESS, not done)
    -- | 'failed' -> for eSign only, the Step 9 webhook later moves
    -- 'success' to 'completed' once actually signed, or 'failed' with a
    -- specific error_message (rejected/expired/cancelled). 'revoked' is set
    -- by the eSign revoke endpoint (Step 8).
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    request_payload JSONB,
    response_payload JSONB,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- API CALLBACK LOGS
-- One row per attempt to forward a webhook-driven status update to an API
-- client's own callback_url (Step 9, Part 5/6) — a separate table rather
-- than columns on api_transactions because one transaction can have several
-- forwarding attempts (retries land here later) without overwriting history.
-- =========================================

CREATE TABLE IF NOT EXISTS api_callback_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    transaction_id UUID NOT NULL REFERENCES api_transactions(id) ON DELETE CASCADE,
    callback_url TEXT NOT NULL,

    request_payload JSONB,
    response_status INTEGER,
    response_body TEXT,
    status VARCHAR(20) NOT NULL,   -- 'success' | 'failed'

    attempted_at TIMESTAMPTZ DEFAULT now()
);


-- =========================================
-- MANUAL ESTAMP — a separate, internally-processed service (NO SignDesk
-- stamp API integration, unlike b2b_stamp_transaction): a partner uploads a
-- document and requests a stamp amount; Super Admin physically/manually
-- arranges the stamping outside the system, then uploads the resulting
-- stamped copy here. Optionally followed by a real eSign workflow on that
-- stamped copy (reuses b2b_esign_transaction/b2b_esign_signer generically —
-- see esign_service.py's Manual eStamp branch — not a separate table).
--
-- orders.status carries this service's own richer flow (see
-- partner.py's MANUAL_ESTAMP_STATUS_FLOW): Submitted -> Stamp Processing ->
-- Stamp Completed -> [eSign Pending -> eSign Completed, only if
-- esign_required] -> Completed. Wallet deduction (stamp_amount only, never
-- the service fee or eSign charge) happens exactly once, the moment the
-- order reaches Completed — same rule and same stamp_value_wallet_debited
-- guard as eStamp Bulk.
-- =========================================

CREATE TABLE IF NOT EXISTS b2b_manual_estamp_order (
    order_id UUID PRIMARY KEY
        REFERENCES orders(id)
        ON DELETE CASCADE,

    stamp_state_id UUID NOT NULL REFERENCES state(id),
    stamp_amount NUMERIC(12,2) NOT NULL,
    -- Manual eStamp's own Base/Service Price at order-creation time (see
    -- organization_service_pricing) — snapshotted here the same way
    -- b2b_estamp_bulk_order.service_fee is, kept separate from order_charge
    -- below (which is only the admin-defined additional charges layered on
    -- top, e.g. Delivery Charge).
    service_fee NUMERIC(12,2) NOT NULL DEFAULT 0,

    esign_required BOOLEAN NOT NULL DEFAULT false,
    -- [{name, email, mobile}] captured at order creation — used when Admin
    -- clicks "Send for eSign" so they don't have to re-enter signer details.
    esign_signers JSONB,

    -- Set once Super Admin uploads the manually-stamped copy (see
    -- STAMPED_UPLOAD_DIR in stamp_service.py — reused for this file too).
    stamped_document_path VARCHAR(500),

    delivery_full_name TEXT,
    delivery_mobile VARCHAR(10),
    delivery_address_line1 TEXT,
    delivery_address_line2 TEXT,
    delivery_city TEXT,
    delivery_state TEXT,
    delivery_pincode VARCHAR(6),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);


-- One-time rename: eStamp Bulk's status flow was simplified from
-- Submitted -> Processing -> Ready for Dispatch -> Dispatched -> Delivered ->
-- Completed down to Pending -> Processed -> Completed (see
-- partner.py's BULK_ESTAMP_STATUS_FLOW). "Submitted" was that old flow's
-- initial state and means exactly the same thing as the new flow's initial
-- "Pending" (order placed, nothing processed/charged yet), so existing
-- orders are moved straight across rather than getting stuck unable to
-- advance under the new, shorter status list. Safe to re-run — the WHERE
-- clause matches nothing once already applied. No orders were ever observed
-- sitting at the other now-removed intermediate statuses (Processing/Ready
-- for Dispatch/Dispatched), so no equivalent backfill is needed for those.
UPDATE orders SET status = 'Pending', updated_at = now()
WHERE service_name = 'eStamp Bulk' AND status = 'Submitted';


-- =========================================
-- NOTIFICATION
-- In-app notifications for the Partner-facing bell (see Header.jsx) — new
-- order placed, order completed, invoice generated. Scoped by
-- organization_id, not organization_user_id: every order always has an
-- organization_id (NOT NULL), but not always an organization_user_id (e.g.
-- Retailer orgs, whose single member login IS the organization — see
-- partner.py), so organization-wide visibility is the correct/only reliable
-- scope. order_id is nullable so this table isn't locked into being
-- order-only forever, but every notification created today always has one.
--
-- audience distinguishes who a row is meant for: 'partner' rows are read by
-- the ordering org itself (GET /api/notifications, organization-scoped);
-- 'admin' rows are read by Super Admin/Admin Portal (GET
-- /api/admin/notifications, global across all orgs — organization_id is
-- still populated on those rows for context, e.g. "Xyz Pvt Ltd placed
-- order...", but the admin query does not filter by it). A new order
-- produces one row of each audience; order-completed/invoice-generated only
-- ever produce 'partner' rows (see app/notification_service.py).
--
-- organization_user_id further narrows a 'partner'-audience row within the
-- org: NULL means partner-owner-only (e.g. "Wallet recharged by Super
-- Admin"); set means it's about one specific Partner User's own activity
-- (their order/eSign/eKYC/eStamp/wallet event) — visible to that Partner
-- User AND to the partner-owner login, since a Partner manages every user
-- under their org (see app/routes/notifications.py's _member_scope_clause).
-- Not tied to order_id's own organization_user_id — wallet events have no
-- order_id at all — so this is set directly by whichever notify_* call
-- created the row.
-- =========================================

CREATE TABLE IF NOT EXISTS notification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    order_id UUID
        REFERENCES orders(id)
        ON DELETE CASCADE,

    -- 'new_order' | 'order_completed' | 'invoice_generated' | 'wallet_recharged'
    -- | 'wallet_deducted' | 'insufficient_balance' | 'esign_status' |
    -- 'ekyc_result' | 'estamp_status' — enforced at the application layer
    -- (see app/notification_service.py), same convention as
    -- service_name/charge_name elsewhere in this schema rather than a DB
    -- CHECK constraint.
    type VARCHAR(50) NOT NULL,

    title VARCHAR(255) NOT NULL,
    message TEXT,

    is_read BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now(),

    -- 'partner' | 'admin' — see table comment above. Enforced at the
    -- application layer, same convention as `type`.
    audience VARCHAR(20) NOT NULL DEFAULT 'partner',

    organization_user_id UUID
        REFERENCES organization_users(id)
        ON DELETE SET NULL
);

ALTER TABLE notification ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'partner';
ALTER TABLE notification ADD COLUMN IF NOT EXISTS organization_user_id UUID REFERENCES organization_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_organization_id ON notification(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_audience ON notification(audience, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_organization_user_id ON notification(organization_user_id, created_at DESC);


-- =========================================
-- FINANCIAL YEAR
-- Admin-managed list (Accounts > Invoice Settings > Financial Year) —
-- replaces the old scheme where the fiscal year segment of an invoice
-- number was silently derived from invoice_date (see the old
-- accounts.py:_fiscal_year_start). Numbering now always uses whichever FY
-- is marked Active here, independent of any invoice's own date, so Super
-- Admin can switch back to an older Active FY and its series picks up
-- exactly where it left off (see invoice_series_counters below), never
-- restarting at 1.
-- =========================================

CREATE TABLE IF NOT EXISTS financial_year (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- e.g. "2026-27" — display only, start_year is the value everything else
    -- (numbering, the active-FY lookup) actually keys off.
    label VARCHAR(20) NOT NULL UNIQUE,
    start_year SMALLINT NOT NULL UNIQUE,

    is_active BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- At most one Active FY at a time — a plain UNIQUE(is_active) would reject a
-- second *inactive* row too (false = false), so this is scoped to only the
-- true rows via a partial index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_year_one_active ON financial_year(is_active) WHERE is_active = true;


-- =========================================
-- INVOICE SERIES SETTINGS
-- Per-series (Invoice / Reimbursement / Receipt — see
-- app/routes/accounts.py's SERIES_KEYS) configuration: a free-text prefix
-- and whether that series' numbers embed the Active Financial Year's digits
-- at all (use_financial_year = false means a single, never-resetting
-- counter with no FY segment). Replaces the old hardcoded "INV"/"ST/"
-- literals in accounts.py's number formatter.
-- =========================================

CREATE TABLE IF NOT EXISTS invoice_series_settings (
    series_key VARCHAR(30) PRIMARY KEY,

    prefix VARCHAR(20) NOT NULL,
    use_financial_year BOOLEAN NOT NULL DEFAULT true,

    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO invoice_series_settings (series_key, prefix, use_financial_year) VALUES
    ('invoice', 'INV', true),
    ('reimbursement', 'INVST', true),
    ('receipt', 'RCPT', true)
ON CONFLICT (series_key) DO NOTHING;


-- =========================================
-- INVOICE SERIES COUNTERS
-- One running counter per (series_key, financial_year_id) — or per
-- series_key alone (financial_year_id NULL) for a series with
-- use_financial_year = false. Two partial unique indexes instead of one
-- plain UNIQUE(series_key, financial_year_id), since Postgres treats every
-- NULL as distinct from every other NULL under a normal unique constraint —
-- without them, a "no FY" series could accumulate multiple counter rows
-- instead of sharing exactly one.
-- =========================================

CREATE TABLE IF NOT EXISTS invoice_series_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    series_key VARCHAR(30) NOT NULL,
    financial_year_id UUID REFERENCES financial_year(id),

    next_number INTEGER NOT NULL DEFAULT 1,

    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_series_counters_with_fy
    ON invoice_series_counters(series_key, financial_year_id) WHERE financial_year_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_series_counters_no_fy
    ON invoice_series_counters(series_key) WHERE financial_year_id IS NULL;

-- One-time backfill: seed a financial_year row for every fiscal_year_start
-- already recorded in the legacy invoice_number_sequences counter (see
-- below), then carry each one's next_number across into the new
-- invoice_series_counters table keyed by the matching financial_year row —
-- so a partner whose FY 2025-26 invoice numbering was already mid-sequence
-- keeps counting from there instead of silently resetting to 1 the moment
-- this migration runs. Safe to re-run: ON CONFLICT DO NOTHING against the
-- UNIQUE constraints above means it only ever inserts once.
INSERT INTO financial_year (label, start_year)
SELECT DISTINCT
    fiscal_year_start || '-' || RIGHT((fiscal_year_start + 1)::text, 2),
    fiscal_year_start
FROM invoice_number_sequences
ON CONFLICT (start_year) DO NOTHING;

-- Also guarantees the real current fiscal year has a row even on a brand
-- new install with no invoices yet.
INSERT INTO financial_year (label, start_year)
SELECT cy || '-' || RIGHT((cy + 1)::text, 2), cy
FROM (SELECT (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
                    THEN EXTRACT(YEAR FROM CURRENT_DATE)
                    ELSE EXTRACT(YEAR FROM CURRENT_DATE) - 1 END)::smallint AS cy) current_fy
ON CONFLICT (start_year) DO NOTHING;

-- Mark the current fiscal year Active only the very first time this runs
-- (i.e. only while nothing is active yet) — never unconditionally, or every
-- re-apply of this file would silently override whatever FY Super Admin has
-- since chosen from the Invoice Settings screen.
UPDATE financial_year SET is_active = true, updated_at = now()
WHERE start_year = (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
                         THEN EXTRACT(YEAR FROM CURRENT_DATE)
                         ELSE EXTRACT(YEAR FROM CURRENT_DATE) - 1 END)::smallint
  AND NOT EXISTS (SELECT 1 FROM financial_year WHERE is_active = true);

INSERT INTO invoice_series_counters (series_key, financial_year_id, next_number)
SELECT
    CASE s.invoice_type WHEN 'Invoice' THEN 'invoice' WHEN 'Reimbursement' THEN 'reimbursement' END,
    fy.id,
    s.next_number
FROM invoice_number_sequences s
JOIN financial_year fy ON fy.start_year = s.fiscal_year_start
ON CONFLICT DO NOTHING;


-- =========================================
-- INVOICE TERMS SETTINGS
-- Single admin-editable block (Accounts > Terms & Condition) rendered onto
-- every generated invoice PDF — replaces the old hardcoded per-invoice-type
-- _TERMS_BY_TYPE dict in accounts.py. One line per bullet point.
-- =========================================

CREATE TABLE IF NOT EXISTS invoice_terms_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    content TEXT NOT NULL,

    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES users(id)
);

-- Leads with the Reimbursement-specific pass-through clause the old
-- per-type _TERMS_BY_TYPE dict used to show only on Reimbursement invoices
-- — kept here since this is now a single shared block across every invoice
-- type, so it's still true and relevant on a normal Invoice too (just not
-- the whole story there), rather than silently dropping it.
INSERT INTO invoice_terms_settings (content)
SELECT
    'This invoice reflects the reimbursement of stamp duty charges paid by the vendor on your behalf in relation to the execution of the agreement between the parties.' || E'\n' ||
    'The vendor has incurred this cost upfront solely for the purpose of facilitating timely execution and compliance.' || E'\n' ||
    'This is not a service charge, but a direct pass-through of a statutory obligation borne on your behalf.' || E'\n' ||
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct'

WHERE NOT EXISTS (SELECT 1 FROM invoice_terms_settings);


-- =========================================
-- LOAN APPLICATIONS — normalized storage for the multi-party Loan
-- Application flow (see LoanDocumentFlow.jsx / app/routes/partner_user.py's
-- PartyInput and its sub-models). Written by _create_order
-- (app/routes/partner.py) inside the same transaction as the orders INSERT,
-- alongside (not instead of) orders.loan_details JSONB — that column stays
-- the source of truth the generated PDF/draft flow round-trips through;
-- these tables exist so future features (search/report across
-- applications by party) can query with plain SQL instead of JSONB paths.
-- One loan_applications row per loan order (1:1 with orders, like
-- b2b_esign_transaction); one loan_application_parties row per
-- Applicant/Co-Applicant/Guarantor; the five *_party_* tables hold that
-- party's repeatable-row sections (Income/Existing Loans/Bank
-- Accounts/Assets/References). Addresses and loan-type-specific fields
-- (vehicle/property/farm) stay as JSONB sub-objects — nothing queries by
-- street name or by a farm's irrigation type, so normalizing those further
-- buys nothing.
-- =========================================

CREATE TABLE IF NOT EXISTS loan_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES orders(id)
        ON DELETE CASCADE,

    loan_type_document_name VARCHAR(150),
    language VARCHAR(20),
    loan_amount NUMERIC(14,2),
    tenure_months INTEGER,
    interest_rate NUMERIC(6,3),
    repayment_frequency VARCHAR(20),

    -- Vehicle/property/farm details (LOAN_TYPE_CONFIG's per-type dynamic
    -- fields) and the confirmed documents checklist — both genuinely
    -- variable-shaped per loan type, kept as JSONB rather than columns.
    loan_type_fields JSONB,
    documents_checklist JSONB,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_applications_order_id ON loan_applications(order_id);

CREATE TABLE IF NOT EXISTS loan_application_parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    loan_application_id UUID NOT NULL
        REFERENCES loan_applications(id)
        ON DELETE CASCADE,

    role VARCHAR(20) NOT NULL CHECK (role IN ('applicant', 'co_applicant', 'guarantor')),

    -- Personal / KYC — mirrors PartyPersonal in partner_user.py field-for-field.
    full_name VARCHAR(255),
    gender VARCHAR(20),
    date_of_birth VARCHAR(20),
    marital_status VARCHAR(20),
    spouse_name VARCHAR(255),
    father_name VARCHAR(255),
    mother_maiden_name VARCHAR(255),
    category VARCHAR(20),
    religion VARCHAR(50),
    nationality VARCHAR(50),
    residential_status VARCHAR(30),
    no_of_dependents VARCHAR(10),
    occupation VARCHAR(100),
    pan_number VARCHAR(20),
    aadhaar_number VARCHAR(20),
    voter_id VARCHAR(30),
    driving_license VARCHAR(30),
    passport_number VARCHAR(30),
    passport_valid_upto VARCHAR(20),

    -- Address — mirrors PartyAddress/PartyAddressBlock; kept as JSONB
    -- sub-objects (see note above).
    present_address JSONB,
    permanent_same_as_present BOOLEAN DEFAULT true,
    permanent_address JSONB,
    office_address JSONB,

    -- Employment / Business — mirrors PartyEmployment field-for-field.
    occupation_type VARCHAR(40),
    employer_name VARCHAR(255),
    designation VARCHAR(100),
    department VARCHAR(100),
    employee_no VARCHAR(50),
    employment_status VARCHAR(30),
    organization_type VARCHAR(40),
    total_experience VARCHAR(30),
    years_present_job VARCHAR(30),
    business_name VARCHAR(255),
    business_type VARCHAR(40),
    monthly_income NUMERIC(14,2),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_application_parties_application_id ON loan_application_parties(loan_application_id);
CREATE INDEX IF NOT EXISTS idx_loan_application_parties_pan ON loan_application_parties(pan_number);
CREATE INDEX IF NOT EXISTS idx_loan_application_parties_aadhaar ON loan_application_parties(aadhaar_number);

-- Repeatable-row sections — mirrors IncomeRow/ExistingLoanRow/BankAccountRow/
-- AssetRow/ReferenceRow in partner_user.py, one table each.

CREATE TABLE IF NOT EXISTS loan_application_party_income (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES loan_application_parties(id) ON DELETE CASCADE,
    income_head VARCHAR(100),
    gross_income NUMERIC(14,2),
    net_income NUMERIC(14,2),
    frequency VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_application_party_income_party_id ON loan_application_party_income(party_id);

CREATE TABLE IF NOT EXISTS loan_application_party_existing_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES loan_application_parties(id) ON DELETE CASCADE,
    loan_bank VARCHAR(255),
    loan_type VARCHAR(100),
    loan_emi NUMERIC(14,2),
    loan_tenure VARCHAR(30),
    loan_outstanding NUMERIC(14,2),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_application_party_existing_loans_party_id ON loan_application_party_existing_loans(party_id);

CREATE TABLE IF NOT EXISTS loan_application_party_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES loan_application_parties(id) ON DELETE CASCADE,
    bank_name VARCHAR(255),
    bank_branch VARCHAR(255),
    account_type VARCHAR(30),
    account_number VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_application_party_bank_accounts_party_id ON loan_application_party_bank_accounts(party_id);

CREATE TABLE IF NOT EXISTS loan_application_party_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES loan_application_parties(id) ON DELETE CASCADE,
    asset_type VARCHAR(30),
    asset_description VARCHAR(255),
    asset_value NUMERIC(14,2),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_application_party_assets_party_id ON loan_application_party_assets(party_id);

CREATE TABLE IF NOT EXISTS loan_application_party_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES loan_application_parties(id) ON DELETE CASCADE,
    reference_name VARCHAR(255),
    reference_address VARCHAR(500),
    reference_phone VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_application_party_references_party_id ON loan_application_party_references(party_id);