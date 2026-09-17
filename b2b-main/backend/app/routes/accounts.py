from datetime import date
from decimal import Decimal
from io import BytesIO
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, field_validator
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.database import get_connection, get_transaction

router = APIRouter()

INVOICE_TYPES = ("Reimbursement", "Invoice")
KARNATAKA_STATE_MATCH = "karnataka"


class InvoiceItemIn(BaseModel):
    description: str
    hsn_sac: str | None = None
    qty: Decimal = Decimal("1")
    rate: Decimal
    cgst_percentage: Decimal = Decimal("0")
    sgst_percentage: Decimal = Decimal("0")
    igst_percentage: Decimal = Decimal("0")


class InvoiceCreate(BaseModel):
    customer_id: UUID
    invoice_type: str
    invoice_date: date | None = None
    due_date: date | None = None
    terms: str = "Due on Receipt"
    # Ignored for Reimbursement — that type is always a single fixed
    # "Stamp Duty Recovery" line, only the rate is taken from here.
    items: list[InvoiceItemIn] = []

    @field_validator("invoice_type")
    @classmethod
    def _valid_type(cls, value: str) -> str:
        if value not in INVOICE_TYPES:
            raise ValueError(f"invoice_type must be one of {INVOICE_TYPES}")
        return value


class InvoiceUpdate(BaseModel):
    invoice_date: date | None = None
    due_date: date | None = None
    terms: str | None = None
    items: list[InvoiceItemIn] | None = None


def _is_karnataka(state_name: str | None) -> bool:
    return (state_name or "").strip().lower() == KARNATAKA_STATE_MATCH


def _resolve_items(invoice_type: str, items: list[InvoiceItemIn], customer_state: str | None) -> list[InvoiceItemIn]:
    """Applies the two business rules from the Accounts module spec:
    Reimbursement is always a single 'Stamp Duty Recovery' line, and an
    Invoice's tax fields are forced to match the customer's state (CGST+SGST
    for Karnataka, IGST otherwise) regardless of what the client sent —
    this is enforced server-side, not just as a UI affordance.
    """
    if invoice_type == "Reimbursement":
        rate = items[0].rate if items else Decimal("0")
        return [InvoiceItemIn(description="Stamp Duty Recovery", qty=Decimal("1"), rate=rate)]

    if not items:
        raise HTTPException(status_code=400, detail="At least one line item is required")

    karnataka = _is_karnataka(customer_state)
    resolved = []
    for item in items:
        data = item.model_dump()
        if karnataka:
            data["igst_percentage"] = Decimal("0")
        else:
            data["cgst_percentage"] = Decimal("0")
            data["sgst_percentage"] = Decimal("0")
        resolved.append(InvoiceItemIn(**data))
    return resolved


def _line_amount(item: InvoiceItemIn) -> Decimal:
    return (item.qty * item.rate).quantize(Decimal("0.01"))


# =========================================
# INVOICE NUMBERING
# Three independently configurable series (Accounts > Invoice Settings) —
# 'invoice', 'reimbursement', 'receipt' — each with its own free-text prefix
# and an independent counter. A series with use_financial_year=true embeds
# the Active Financial Year's digits (see financial_year table) and its
# counter is scoped per (series, financial_year) — switching Active FY never
# resets that FY's own count, it just resumes wherever that FY last left
# off. A series with use_financial_year=false has one single counter that
# never resets at all. The fiscal year segment always comes from whichever
# FY is marked Active, never from an invoice's own invoice_date (that's a
# deliberate departure from the old scheme, where the date silently chose
# the FY segment — see the FINANCIAL YEAR admin section for why).
# =========================================

SERIES_KEYS = ("invoice", "reimbursement", "receipt")


def _active_financial_year(connection: Any) -> dict[str, Any] | None:
    return connection.execute(
        "SELECT id, label, start_year FROM financial_year WHERE is_active = true LIMIT 1"
    ).fetchone()


def _invoice_series_settings(connection: Any, series_key: str) -> dict[str, Any]:
    row = connection.execute(
        "SELECT series_key, prefix, use_financial_year FROM invoice_series_settings WHERE series_key = %s",
        (series_key,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=500, detail=f"No numbering settings configured for '{series_key}'")
    return row


def _fy_digits(financial_year: dict[str, Any] | None) -> str:
    if not financial_year:
        return ""
    start_year = financial_year["start_year"]
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def _reserve_next_number(connection: Any, series_key: str, financial_year_id: UUID | None) -> int:
    """Atomically claims and increments the counter for (series_key,
    financial_year_id) — or for series_key alone when financial_year_id is
    None (a series with use_financial_year=false). Two separate statements
    (not one with a dynamic ON CONFLICT target) since each targets a
    different partial unique index — see invoice_series_counters in
    schema.sql for why a plain UNIQUE(series_key, financial_year_id) can't
    do this alone."""
    if financial_year_id is not None:
        row = connection.execute(
            """
            INSERT INTO invoice_series_counters (series_key, financial_year_id, next_number)
            VALUES (%(series_key)s, %(financial_year_id)s, 2)
            ON CONFLICT (series_key, financial_year_id) WHERE financial_year_id IS NOT NULL
            DO UPDATE SET next_number = invoice_series_counters.next_number + 1, updated_at = now()
            RETURNING next_number - 1 AS issued_number
            """,
            {"series_key": series_key, "financial_year_id": financial_year_id},
        ).fetchone()
    else:
        row = connection.execute(
            """
            INSERT INTO invoice_series_counters (series_key, financial_year_id, next_number)
            VALUES (%(series_key)s, NULL, 2)
            ON CONFLICT (series_key) WHERE financial_year_id IS NULL
            DO UPDATE SET next_number = invoice_series_counters.next_number + 1, updated_at = now()
            RETURNING next_number - 1 AS issued_number
            """,
            {"series_key": series_key},
        ).fetchone()
    return row["issued_number"]


def _generate_series_number(connection: Any, series_key: str) -> str:
    settings = _invoice_series_settings(connection, series_key)
    financial_year = _active_financial_year(connection) if settings["use_financial_year"] else None
    if settings["use_financial_year"] and not financial_year:
        raise HTTPException(
            status_code=400,
            detail="No Active Financial Year is set. Set one in Accounts > Invoice Settings before generating numbers.",
        )
    issued_number = _reserve_next_number(connection, series_key, financial_year["id"] if financial_year else None)
    return f"{settings['prefix']}{_fy_digits(financial_year)}{str(issued_number).zfill(4)}"


def _next_invoice_number(connection: Any, invoice_type: str, invoice_date: date) -> str:
    """invoice_date is accepted only for call-site compatibility (it's still
    stored separately on the invoice row itself) — it no longer drives the
    number's fiscal-year segment, see the module docstring above."""
    del invoice_date
    return _generate_series_number(connection, invoice_type.lower())


def generate_receipt_number(connection: Any) -> str:
    """Public entry point for a Receipt-generation flow — the 'receipt'
    series' numbering config already exists and is fully wired (Accounts >
    Invoice Settings > Receipt Number) even though nothing in this codebase
    creates a Receipt document yet; call this the moment one does."""
    return _generate_series_number(connection, "receipt")


def _with_totals(invoice: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    # Display-only relabel, applied here so both the View popup
    # (InvoiceViewModal.jsx, via get_invoice) and the downloaded PDF
    # (download_invoice_pdf reuses get_invoice) show it. The underlying
    # b2b_invoice_items.description — copied at generation time from
    # orders.order_charge.charge_name — stays "Bulk eStamp Pricing" in
    # storage, deliberately kept distinct from the org-level Additional
    # Charges config (see partner.BULK_ESTAMP_PRICING_CHARGE_NAME's own
    # comment) so the two can never collide into two identically-labeled
    # "Service Charge" lines on the same invoice for an org that has both.
    from app.routes.partner import BULK_ESTAMP_PRICING_CHARGE_NAME

    items = [
        {**i, "description": "Service Charge"} if i["description"] == BULK_ESTAMP_PRICING_CHARGE_NAME else i
        for i in items
    ]

    subtotal = sum((i["amount"] for i in items), Decimal("0"))
    cgst = sum((i["amount"] * i["cgst_percentage"] / 100 for i in items), Decimal("0"))
    sgst = sum((i["amount"] * i["sgst_percentage"] / 100 for i in items), Decimal("0"))
    igst = sum((i["amount"] * i["igst_percentage"] / 100 for i in items), Decimal("0"))
    return {
        **invoice,
        "items": items,
        "subtotal": subtotal,
        "cgst_amount": cgst,
        "sgst_amount": sgst,
        "igst_amount": igst,
        "total": subtotal + cgst + sgst + igst,
    }


@router.get("/invoices")
def list_invoices() -> list[dict[str, Any]]:
    # LEFT JOINs (not the original INNER JOIN) — order-generated invoices
    # (see app/invoice_service.py) have no b2b_customers row at all, only the
    # bill_to_* snapshot on b2b_invoices itself, hence the COALESCEs below.
    sql = """
        SELECT
            i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.due_date, i.terms,
            i.customer_id, i.order_id, ord.order_no,
            COALESCE(c.company_name, i.bill_to_name) AS company_name,
            COALESCE(c.gstin, i.bill_to_gstin) AS gstin,
            COALESCE(c.state, i.bill_to_state) AS state,
            COALESCE(SUM(it.amount), 0) AS subtotal,
            COALESCE(SUM(it.amount * it.cgst_percentage / 100), 0) AS cgst_amount,
            COALESCE(SUM(it.amount * it.sgst_percentage / 100), 0) AS sgst_amount,
            COALESCE(SUM(it.amount * it.igst_percentage / 100), 0) AS igst_amount
        FROM b2b_invoices i
        LEFT JOIN b2b_customers c ON c.id = i.customer_id
        LEFT JOIN orders ord ON ord.id = i.order_id
        LEFT JOIN b2b_invoice_items it ON it.invoice_id = i.id
        GROUP BY i.id, i.order_id, ord.order_no, c.company_name, c.gstin, c.state, i.bill_to_name, i.bill_to_gstin, i.bill_to_state
        ORDER BY i.created_at DESC
    """
    with get_connection() as connection:
        rows = connection.execute(sql).fetchall()

    for row in rows:
        row["total"] = row["subtotal"] + row["cgst_amount"] + row["sgst_amount"] + row["igst_amount"]
    return rows


@router.post("/invoices", status_code=201)
def create_invoice(payload: InvoiceCreate) -> dict[str, Any]:
    with get_transaction() as connection:
        customer = connection.execute(
            "SELECT * FROM b2b_customers WHERE id = %s", (payload.customer_id,)
        ).fetchone()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

        items = _resolve_items(payload.invoice_type, payload.items, customer["state"])
        invoice_date = payload.invoice_date or date.today()
        invoice_number = _next_invoice_number(connection, payload.invoice_type, invoice_date)

        invoice = connection.execute(
            """
            INSERT INTO b2b_invoices (invoice_number, customer_id, invoice_type, invoice_date, due_date, terms)
            VALUES (
                %(invoice_number)s, %(customer_id)s, %(invoice_type)s,
                %(invoice_date)s, COALESCE(%(due_date)s, CURRENT_DATE), %(terms)s
            )
            RETURNING *
            """,
            {
                "invoice_number": invoice_number,
                "customer_id": payload.customer_id,
                "invoice_type": payload.invoice_type,
                "invoice_date": invoice_date,
                "due_date": payload.due_date,
                "terms": payload.terms,
            },
        ).fetchone()

        item_rows = []
        for item in items:
            amount = _line_amount(item)
            row = connection.execute(
                """
                INSERT INTO b2b_invoice_items
                    (invoice_id, description, hsn_sac, qty, rate, cgst_percentage, sgst_percentage, igst_percentage, amount)
                VALUES
                    (%(invoice_id)s, %(description)s, %(hsn_sac)s, %(qty)s, %(rate)s,
                     %(cgst_percentage)s, %(sgst_percentage)s, %(igst_percentage)s, %(amount)s)
                RETURNING *
                """,
                {**item.model_dump(), "invoice_id": invoice["id"], "amount": amount},
            ).fetchone()
            item_rows.append(row)

    return _with_totals(invoice, item_rows)


@router.get("/invoices/next-number")
def peek_next_invoice_number(invoice_type: str) -> dict[str, str]:
    """Preview only — does not reserve the number. The real one is assigned
    atomically in _next_invoice_number at creation time, so this can go
    stale if another invoice of the same series is created first. No longer
    takes invoice_date — the fiscal-year segment always comes from the
    Active Financial Year now, not the invoice's own date (see the
    INVOICE NUMBERING section above)."""
    if invoice_type not in INVOICE_TYPES:
        raise HTTPException(status_code=400, detail=f"invoice_type must be one of {INVOICE_TYPES}")

    series_key = invoice_type.lower()
    with get_connection() as connection:
        settings = _invoice_series_settings(connection, series_key)
        financial_year = _active_financial_year(connection) if settings["use_financial_year"] else None
        if settings["use_financial_year"] and not financial_year:
            return {"invoice_number": "No Active Financial Year set"}

        if financial_year:
            row = connection.execute(
                "SELECT next_number FROM invoice_series_counters WHERE series_key = %s AND financial_year_id = %s",
                (series_key, financial_year["id"]),
            ).fetchone()
        else:
            row = connection.execute(
                "SELECT next_number FROM invoice_series_counters WHERE series_key = %s AND financial_year_id IS NULL",
                (series_key,),
            ).fetchone()

    issued_number = row["next_number"] if row else 1
    return {"invoice_number": f"{settings['prefix']}{_fy_digits(financial_year)}{str(issued_number).zfill(4)}"}


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        invoice = connection.execute(
            """
            SELECT i.*,
                   COALESCE(c.company_name, i.bill_to_name) AS company_name,
                   COALESCE(c.address, i.bill_to_address) AS address,
                   c.city, COALESCE(c.state, i.bill_to_state) AS state, c.postal_code,
                   COALESCE(c.gstin, i.bill_to_gstin) AS gstin,
                   ord.order_no
            FROM b2b_invoices i
            LEFT JOIN b2b_customers c ON c.id = i.customer_id
            LEFT JOIN orders ord ON ord.id = i.order_id
            WHERE i.id = %s
            """,
            (invoice_id,),
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        items = connection.execute(
            "SELECT * FROM b2b_invoice_items WHERE invoice_id = %s ORDER BY id", (invoice_id,)
        ).fetchall()
        terms_conditions = _invoice_terms_content(connection)

    result = _with_totals(invoice, items)
    # Everything below is display-only, derived from the same helpers/
    # constants the PDF itself renders from (_place_of_supply, _amount_to_words,
    # _BANK, _COMPANY, _INVOICE_NOTE, invoice_terms_settings) — computed fresh
    # here rather than stored, exactly like the PDF does, so the "View" popup
    # (see InvoiceViewModal.jsx) never drifts from what Download actually produces.
    result["place_of_supply"] = _place_of_supply(result["state"])
    result["balance_due"] = result["total"]
    result["amount_in_words"] = _amount_to_words(result["total"])
    result["terms_conditions"] = terms_conditions
    result["note"] = _INVOICE_NOTE
    result["bank"] = _BANK
    result["company"] = _COMPANY
    return result


@router.patch("/invoices/{invoice_id}")
def update_invoice(invoice_id: UUID, payload: InvoiceUpdate) -> dict[str, Any]:
    with get_transaction() as connection:
        invoice = connection.execute(
            "SELECT * FROM b2b_invoices WHERE id = %s", (invoice_id,)
        ).fetchone()
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")

        header = payload.model_dump(exclude={"items"}, exclude_unset=True)
        if header:
            set_clause = ", ".join(f"{field} = %({field})s" for field in header)
            header["invoice_id"] = invoice_id
            invoice = connection.execute(
                f"""
                UPDATE b2b_invoices
                SET {set_clause}, updated_at = now()
                WHERE id = %(invoice_id)s
                RETURNING *
                """,
                header,
            ).fetchone()

        if payload.items is not None:
            # LEFT JOIN + COALESCE, not a plain b2b_customers lookup — an
            # order-generated invoice (see app/invoice_service.py) has no
            # customer_id at all, only the bill_to_state snapshot.
            customer = connection.execute(
                """
                SELECT COALESCE(c.state, i.bill_to_state) AS state
                FROM b2b_invoices i
                LEFT JOIN b2b_customers c ON c.id = i.customer_id
                WHERE i.id = %s
                """,
                (invoice_id,),
            ).fetchone()
            items = _resolve_items(invoice["invoice_type"], payload.items, customer["state"])

            connection.execute("DELETE FROM b2b_invoice_items WHERE invoice_id = %s", (invoice_id,))
            for item in items:
                amount = _line_amount(item)
                connection.execute(
                    """
                    INSERT INTO b2b_invoice_items
                        (invoice_id, description, hsn_sac, qty, rate, cgst_percentage, sgst_percentage, igst_percentage, amount)
                    VALUES
                        (%(invoice_id)s, %(description)s, %(hsn_sac)s, %(qty)s, %(rate)s,
                         %(cgst_percentage)s, %(sgst_percentage)s, %(igst_percentage)s, %(amount)s)
                    """,
                    {**item.model_dump(), "invoice_id": invoice_id, "amount": amount},
                )

        item_rows = connection.execute(
            "SELECT * FROM b2b_invoice_items WHERE invoice_id = %s ORDER BY id", (invoice_id,)
        ).fetchall()

    return _with_totals(invoice, item_rows)


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        result = connection.execute(
            "DELETE FROM b2b_invoices WHERE id = %s RETURNING id", (invoice_id,)
        ).fetchone()
    if not result:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"status": "deleted"}


# =========================================
# FINANCIAL YEAR
# Accounts > Invoice Settings > Financial Year — add new FYs, list them, and
# mark exactly one Active. See financial_year in schema.sql for the
# one-active-at-a-time constraint.
# =========================================


class FinancialYearCreate(BaseModel):
    # e.g. 2027 for FY "2027-28" — the label is always derived from this,
    # never accepted separately, so the two can never disagree.
    start_year: int

    @field_validator("start_year")
    @classmethod
    def _plausible_year(cls, value: int) -> int:
        if value < 2000 or value > 2100:
            raise ValueError("start_year must be a plausible calendar year")
        return value


def _financial_year_label(start_year: int) -> str:
    return f"{start_year}-{(start_year + 1) % 100:02d}"


@router.get("/financial-years")
def list_financial_years() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            "SELECT id, label, start_year, is_active, created_at FROM financial_year ORDER BY start_year DESC"
        ).fetchall()


@router.post("/financial-years", status_code=201)
def create_financial_year(payload: FinancialYearCreate) -> dict[str, Any]:
    label = _financial_year_label(payload.start_year)
    with get_transaction() as connection:
        try:
            row = connection.execute(
                """
                INSERT INTO financial_year (label, start_year)
                VALUES (%s, %s)
                RETURNING id, label, start_year, is_active, created_at
                """,
                (label, payload.start_year),
            ).fetchone()
        except UniqueViolation as e:
            raise HTTPException(status_code=400, detail=f"Financial year {label} already exists") from e
    return row


@router.post("/financial-years/{financial_year_id}/activate")
def activate_financial_year(financial_year_id: UUID) -> list[dict[str, Any]]:
    with get_transaction() as connection:
        exists = connection.execute(
            "SELECT id FROM financial_year WHERE id = %s", (financial_year_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Financial year not found")

        # Deactivate everything first, then activate the target — in that
        # order, so the partial unique index on is_active never sees two
        # true rows at once (see idx_financial_year_one_active).
        connection.execute("UPDATE financial_year SET is_active = false, updated_at = now() WHERE is_active = true")
        connection.execute(
            "UPDATE financial_year SET is_active = true, updated_at = now() WHERE id = %s", (financial_year_id,)
        )
    return list_financial_years()


# =========================================
# INVOICE SERIES SETTINGS
# Accounts > Invoice Settings — per-series (Invoice/Reimbursement/Receipt)
# prefix and financial-year toggle. See invoice_series_settings in
# schema.sql and the INVOICE NUMBERING section above for how these actually
# get used.
# =========================================


class InvoiceSeriesSettingUpdate(BaseModel):
    prefix: str
    use_financial_year: bool = True

    @field_validator("prefix")
    @classmethod
    def _prefix_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Prefix is required")
        if len(value) > 20:
            raise ValueError("Prefix must be 20 characters or fewer")
        return value


@router.get("/invoice-settings")
def get_invoice_settings() -> dict[str, Any]:
    with get_connection() as connection:
        series = connection.execute(
            "SELECT series_key, prefix, use_financial_year, updated_at FROM invoice_series_settings ORDER BY series_key"
        ).fetchall()
        active_financial_year = _active_financial_year(connection)
    return {"series": series, "active_financial_year": active_financial_year}


@router.put("/invoice-settings/{series_key}")
def update_invoice_series_setting(series_key: str, payload: InvoiceSeriesSettingUpdate) -> dict[str, Any]:
    if series_key not in SERIES_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown numbering series '{series_key}'")
    with get_transaction() as connection:
        connection.execute(
            """
            INSERT INTO invoice_series_settings (series_key, prefix, use_financial_year, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (series_key)
            DO UPDATE SET prefix = EXCLUDED.prefix, use_financial_year = EXCLUDED.use_financial_year, updated_at = now()
            """,
            (series_key, payload.prefix, payload.use_financial_year),
        )
    return get_invoice_settings()


# =========================================
# INVOICE TERMS SETTINGS
# Accounts > Terms & Condition — the admin-editable block rendered onto
# every generated invoice PDF (see _build_invoice_pdf below). Single shared
# row, always the most recently updated one if more than one ever exists.
# =========================================


class InvoiceTermsUpdate(BaseModel):
    content: str


def _invoice_terms_content(connection: Any) -> str:
    row = connection.execute(
        "SELECT content FROM invoice_terms_settings ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    return row["content"] if row else ""


@router.get("/terms")
def get_invoice_terms() -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, content, updated_at FROM invoice_terms_settings ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
    return row or {"id": None, "content": "", "updated_at": None}


@router.put("/terms")
def update_invoice_terms(payload: InvoiceTermsUpdate) -> dict[str, Any]:
    with get_transaction() as connection:
        existing = connection.execute(
            "SELECT id FROM invoice_terms_settings ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        if existing:
            row = connection.execute(
                "UPDATE invoice_terms_settings SET content = %s, updated_at = now() WHERE id = %s RETURNING id, content, updated_at",
                (payload.content, existing["id"]),
            ).fetchone()
        else:
            row = connection.execute(
                "INSERT INTO invoice_terms_settings (content) VALUES (%s) RETURNING id, content, updated_at",
                (payload.content,),
            ).fetchone()
    return row


# =========================================
# INVOICE PDF
# Renders the fixed company letterhead below, matching the reference
# Reimbursement/Invoice templates: same header, tax-column layout (CGST+SGST
# for Karnataka customers, IGST otherwise — same rule as _resolve_items),
# bank details, and terms & conditions (which differ by invoice_type).
# =========================================

_COMPANY = {
    "name": "Ethotix Private limited",
    "address_lines": (
        "#41, 1st Floor, Narayana Ashrama Extn, Analekoppa,",
        "Shiravala Road Sagar Karnataka 577401",
    ),
    "gstin": "29AAICE9474H1Z0",
    "phone": "91-9964666561",
    "email": "payments@legaldesk.com",
}

_BANK = {
    "bank_name": "IDFC FIRST BANK",
    "account_name": "ETHOTIX PRIVATE LIMITED",
    "account_number": "10236987254",
    "ifsc": "IDFB0080473",
}

_INVOICE_NOTE = "Thanks for Business"

# Standard GST state/UT codes — public reference data, not business logic.
_GST_STATE_CODES = {
    "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03", "chandigarh": "04",
    "uttarakhand": "05", "haryana": "06", "delhi": "07", "rajasthan": "08", "uttar pradesh": "09",
    "bihar": "10", "sikkim": "11", "arunachal pradesh": "12", "nagaland": "13", "manipur": "14",
    "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18", "west bengal": "19",
    "jharkhand": "20", "odisha": "21", "chhattisgarh": "22", "madhya pradesh": "23", "gujarat": "24",
    "dadra and nagar haveli and daman and diu": "26", "maharashtra": "27", "karnataka": "29",
    "goa": "30", "lakshadweep": "31", "kerala": "32", "tamil nadu": "33", "puducherry": "34",
    "andaman and nicobar islands": "35", "telangana": "36", "andhra pradesh": "37", "ladakh": "38",
}

_ONES = (
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
)
_TENS = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")


def _place_of_supply(state_name: str | None) -> str:
    if not state_name:
        return "-"
    code = _GST_STATE_CODES.get(state_name.strip().lower())
    return f"{state_name}({code})" if code else state_name


def _three_digit_words(n: int) -> str:
    parts = []
    if n >= 100:
        parts.append(f"{_ONES[n // 100]} Hundred")
        n %= 100
    if n >= 20:
        parts.append(_TENS[n // 10])
        if n % 10:
            parts.append(_ONES[n % 10])
    elif n > 0:
        parts.append(_ONES[n])
    return " ".join(parts)


def _amount_to_words(amount: Decimal) -> str:
    rupees = int(amount)
    paise = int((amount - rupees) * 100)

    crore, remainder = divmod(rupees, 10_000_000)
    lakh, remainder = divmod(remainder, 100_000)
    thousand, remainder = divmod(remainder, 1000)
    hundred = remainder

    segments = []
    if crore:
        segments.append(f"{_three_digit_words(crore)} Crore")
    if lakh:
        segments.append(f"{_three_digit_words(lakh)} Lakh")
    if thousand:
        segments.append(f"{_three_digit_words(thousand)} Thousand")
    if hundred:
        segments.append(_three_digit_words(hundred))

    words = f"Indian Rupee {' '.join(segments)}" if segments else "Indian Rupee Zero"
    if paise:
        words += f" and {_three_digit_words(paise)} Paise"
    return f"{words} Only"


def _fmt_amount(value: Any) -> str:
    return f"{Decimal(value):,.2f}"


def _fmt_qty(value: Any) -> str:
    """Whole quantities print without decimals ("2", not "2.00") — matches
    the reference invoices, which never show a Qty column with .00."""
    d = Decimal(value)
    return str(int(d)) if d == d.to_integral_value() else f"{d:,.2f}"


def _fmt_pct(value: Any) -> str:
    d = Decimal(value)
    return str(int(d)) if d == d.to_integral_value() else f"{d:,.2f}"


def _fmt_date(value: date | None) -> str:
    return value.strftime("%d/%m/%Y") if value else "-"


# Content area is 167mm wide (A4 minus the 21.5mm L/R margins the document
# uses below) — every table in this function sums its column widths to
# exactly that, matching the reference invoices' actual measured column
# positions (extracted from the client's PDFs with PyMuPDF) rather than an
# arbitrary round number.


def _invoice_pdf_elements(invoice: dict[str, Any]) -> list[Any]:
    """Builds the flowable elements for one invoice — split out from
    _build_invoice_pdf/_build_invoices_pdf below so a multi-invoice order
    (see eStamp Bulk's Reimbursement + Invoice pair, invoice_service.
    download_invoice_pdf_for_order) can render several invoices as
    consecutive pages in one PDF, each starting fresh via a PageBreak,
    without a second PDF-merging dependency."""
    is_reimbursement = invoice["invoice_type"] == "Reimbursement"
    karnataka = _is_karnataka(invoice["state"])

    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    small = ParagraphStyle("small", parent=normal, fontSize=8, leading=10.5)
    bold_small = ParagraphStyle("boldSmall", parent=small, fontName="Helvetica-Bold")
    # More generous line height than body `small` — matches the visible
    # breathing room between the company name/address/GSTIN/phone/email
    # lines in the reference (only that letterhead block, not body text
    # elsewhere, which stays at `small`'s tighter spacing).
    letterhead_small = ParagraphStyle("letterheadSmall", parent=small, leading=13)
    company_name_style = ParagraphStyle(
        "companyName", parent=normal, fontSize=14, leading=17, fontName="Helvetica-Bold", spaceAfter=3,
    )
    title_style = ParagraphStyle("title", parent=normal, fontSize=18, leading=21, fontName="Helvetica-Bold", alignment=TA_RIGHT)
    cell_right = ParagraphStyle("cellRight", parent=small, alignment=TA_RIGHT)
    bold_right = ParagraphStyle("boldRight", parent=bold_small, alignment=TA_RIGHT)
    cell_center = ParagraphStyle("cellCenter", parent=small, alignment=TA_CENTER)

    elements: list[Any] = []

    # ---- Header: company block + document title ----
    company_block = [
        Paragraph(_COMPANY["name"], company_name_style),
        *[Paragraph(line, letterhead_small) for line in _COMPANY["address_lines"]],
        Paragraph(f"<b>GSTIN:</b> {_COMPANY['gstin']}", letterhead_small),
        Paragraph(_COMPANY["phone"], letterhead_small),
        Paragraph(_COMPANY["email"], letterhead_small),
    ]
    title_text = "REIMBURSEMENT<br/>INVOICE" if is_reimbursement else "INVOICE"
    header_table = Table([[company_block, Paragraph(title_text, title_style)]], colWidths=[106 * mm, 61 * mm])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 6 * mm))

    # ---- Meta block: Invoice #, Place of Supply, Invoice Date, Terms, Due date ----
    # Whole line bold (label AND value) — matches the reference exactly,
    # which is not just a bold label followed by a regular value.
    meta_table = Table(
        [
            [Paragraph(f"<b>Invoice #</b> : {invoice['invoice_number']}", bold_small),
             Paragraph(f"<b>Place of Supply</b> : {_place_of_supply(invoice['state'])}", bold_small)],
            [Paragraph(f"<b>Invoice Date</b> : {_fmt_date(invoice['invoice_date'])}", bold_small), ""],
            [Paragraph(f"<b>Terms</b> : {invoice['terms'] or ''}", bold_small), ""],
            [Paragraph(f"<b>Due date</b> : {_fmt_date(invoice['due_date'])}", bold_small), ""],
        ],
        colWidths=[87.5 * mm, 79.5 * mm],
    )
    meta_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        # Only the vertical divider between the two columns — no horizontal
        # lines between Invoice #/Invoice Date/Terms/Due date, matching the
        # reference (its meta box has zero internal row dividers).
        ("LINEAFTER", (0, 0), (0, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(meta_table)

    # ---- Bill To / Ship To ----
    # No spacer above — the reference has this box sitting flush against the
    # meta box (they share a border line), not separated by a gap.
    # Company name is regular weight here (not bold) — matches the reference;
    # only the "Bill To"/"Ship To" column headers are bold.
    address_bits = [invoice.get("city"), invoice.get("postal_code")]
    address_line = ", ".join(part for part in address_bits if part)
    bill_to = [Paragraph(invoice["company_name"] or "", small)]
    if invoice.get("address"):
        bill_to.append(Paragraph(invoice["address"], small))
    if address_line:
        bill_to.append(Paragraph(address_line, small))
    if invoice.get("gstin"):
        bill_to.append(Paragraph(f"GSTIN {invoice['gstin']}", small))

    bill_ship_table = Table(
        [
            [Paragraph("<b>Bill To</b>", bold_small), Paragraph("<b>Ship To</b>", bold_small)],
            [bill_to, ""],
        ],
        colWidths=[87.5 * mm, 79.5 * mm],
    )
    bill_ship_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.black),
        ("LINEAFTER", (0, 0), (0, -1), 0.5, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F2F2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(bill_ship_table)
    # No spacer here either — the item table sits flush below, same reasoning
    # as above.

    # ---- Item table ----
    # Reimbursement reference invoices always show 5 row slots (real line
    # items plus trailing blanks) — matched here so a 1-2 line reimbursement
    # doesn't look sparser than the reference.
    MIN_REIMBURSEMENT_ROWS = 5
    base_style = [
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]

    if is_reimbursement:
        header_rows = 1
        rows = [["#", "Item & Description", "Qty", "Rate", "Amount"]]
        col_widths = [13.4 * mm, 85 * mm, 16.3 * mm, 22.8 * mm, 29.5 * mm]
        for i, item in enumerate(invoice["items"], start=1):
            rows.append([
                str(i), item["description"], _fmt_qty(item["qty"]),
                _fmt_amount(item["rate"]), _fmt_amount(item["amount"]),
            ])
        for _ in range(max(0, MIN_REIMBURSEMENT_ROWS - len(invoice["items"]))):
            rows.append(["", "", "", "", ""])
        style = [
            *base_style,
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F2F2")),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (1, -1), "LEFT"),
        ]
    elif karnataka:
        header_rows = 2
        # Two-row header — "CGST"/"SGST" as group labels spanning their %/Amt
        # sub-columns, matching the reference's nested table head exactly.
        # The group labels (CGST/SGST) are regular weight, not bold — only
        # the %/Amt sub-labels and the vertically-spanned column heads are.
        rows = [
            ["#", "Item & Description", "HSN/SAC", "Qty", "Rate", "CGST", "", "SGST", "", "Amount"],
            ["", "", "", "", "", "%", "Amt", "%", "Amt", ""],
        ]
        col_widths = [11 * mm, 27 * mm, 17 * mm, 9 * mm, 20 * mm, 13 * mm, 13 * mm, 13 * mm, 19 * mm, 25 * mm]
        for i, item in enumerate(invoice["items"], start=1):
            rows.append([
                str(i), item["description"], item["hsn_sac"] or "-", _fmt_qty(item["qty"]), _fmt_amount(item["rate"]),
                _fmt_pct(item["cgst_percentage"]), _fmt_amount(item["amount"] * item["cgst_percentage"] / 100),
                _fmt_pct(item["sgst_percentage"]), _fmt_amount(item["amount"] * item["sgst_percentage"] / 100),
                _fmt_amount(item["amount"]),
            ])
        style = [
            *base_style,
            ("BACKGROUND", (0, 0), (-1, 1), colors.HexColor("#F2F2F2")),
            ("SPAN", (0, 0), (0, 1)), ("SPAN", (1, 0), (1, 1)), ("SPAN", (2, 0), (2, 1)),
            ("SPAN", (3, 0), (3, 1)), ("SPAN", (4, 0), (4, 1)), ("SPAN", (9, 0), (9, 1)),
            ("SPAN", (5, 0), (6, 0)), ("SPAN", (7, 0), (8, 0)),
            ("FONTNAME", (5, 0), (5, 0), "Helvetica"), ("FONTNAME", (7, 0), (7, 0), "Helvetica"),
            ("FONTNAME", (5, 1), (8, 1), "Helvetica-Bold"),
            ("ALIGN", (5, 0), (5, 0), "CENTER"), ("ALIGN", (7, 0), (7, 0), "CENTER"),
            ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 2), (1, -1), "LEFT"),
        ]
    else:
        header_rows = 2
        rows = [
            ["#", "Item & Description", "HSN/SAC", "Qty", "Rate", "IGST", "", "Amount"],
            ["", "", "", "", "", "%", "Amt", ""],
        ]
        col_widths = [11 * mm, 49 * mm, 18 * mm, 10 * mm, 20 * mm, 14 * mm, 20 * mm, 25 * mm]
        for i, item in enumerate(invoice["items"], start=1):
            rows.append([
                str(i), item["description"], item["hsn_sac"] or "-", _fmt_qty(item["qty"]), _fmt_amount(item["rate"]),
                _fmt_pct(item["igst_percentage"]), _fmt_amount(item["amount"] * item["igst_percentage"] / 100),
                _fmt_amount(item["amount"]),
            ])
        style = [
            *base_style,
            ("BACKGROUND", (0, 0), (-1, 1), colors.HexColor("#F2F2F2")),
            ("SPAN", (0, 0), (0, 1)), ("SPAN", (1, 0), (1, 1)), ("SPAN", (2, 0), (2, 1)),
            ("SPAN", (3, 0), (3, 1)), ("SPAN", (4, 0), (4, 1)), ("SPAN", (7, 0), (7, 1)),
            ("SPAN", (5, 0), (6, 0)),
            ("FONTNAME", (5, 0), (5, 0), "Helvetica"),
            ("FONTNAME", (5, 1), (6, 1), "Helvetica-Bold"),
            ("ALIGN", (5, 0), (5, 0), "CENTER"),
            ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 2), (1, -1), "LEFT"),
        ]

    items_table = Table(rows, colWidths=col_widths, repeatRows=header_rows)
    items_table.setStyle(TableStyle(style))
    elements.append(items_table)
    elements.append(Spacer(1, 4 * mm))

    # ---- Totals + Total In Words + Note + Signature ----
    # Matches the reference templates' two-column layout: Total In Words and
    # Note run down the left (unboxed), Sub Total/Total/Balance Due and the
    # signature block run down the right — side by side, not stacked one
    # after another.
    # Representative rate for the (X%) suffix — every line item carries the
    # same cgst/sgst/igst_percentage (see _resolve_items/invoice_service),
    # so the first item's rate is the invoice's rate.
    first_item = invoice["items"][0] if invoice["items"] else {}
    total_rows = [["Sub Total", _fmt_amount(invoice["subtotal"])]]
    if is_reimbursement:
        pass
    elif karnataka:
        total_rows.append([f"CGST ({_fmt_pct(first_item.get('cgst_percentage', 0))}%)", _fmt_amount(invoice["cgst_amount"])])
        total_rows.append([f"SGST ({_fmt_pct(first_item.get('sgst_percentage', 0))}%)", _fmt_amount(invoice["sgst_amount"])])
    else:
        total_rows.append([f"IGST ({_fmt_pct(first_item.get('igst_percentage', 0))}%)", _fmt_amount(invoice["igst_amount"])])
    total_rows.append(["Total", _fmt_amount(invoice["total"])])
    total_rows.append(["Balance Due", _fmt_amount(invoice["total"])])

    # Totals and the signature block are ONE continuously-bordered table (not
    # two separate floating boxes) — matches the reference, where the totals
    # rows and the "For Company / Authorized Signature" box share the same
    # left/right border running unbroken from Sub Total down to Authorized
    # Signature.
    totals_row_count = len(total_rows)
    sig_row_start = totals_row_count
    right_column_rows = [
        [Paragraph(label, bold_small if label in ("Total", "Balance Due") else small),
         Paragraph(value, bold_right if label in ("Total", "Balance Due") else cell_right)]
        for label, value in total_rows
    ] + [
        [Paragraph(f"For {_COMPANY['name']}", cell_center), ""],
        [Spacer(1, 8 * mm), ""],
        [Paragraph("Authorized Signature", cell_center), ""],
    ]
    totals_signature_table = Table(right_column_rows, colWidths=[33 * mm, 35 * mm])
    totals_signature_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("LINEABOVE", (0, totals_row_count - 2), (-1, totals_row_count - 2), 0.5, colors.black),
        ("LINEABOVE", (0, sig_row_start), (-1, sig_row_start), 0.5, colors.black),
        ("SPAN", (0, sig_row_start), (1, sig_row_start)),
        ("SPAN", (0, sig_row_start + 1), (1, sig_row_start + 1)),
        ("SPAN", (0, sig_row_start + 2), (1, sig_row_start + 2)),
        ("LEFTPADDING", (0, sig_row_start), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, sig_row_start), (-1, sig_row_start), 5),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 5),
    ]))

    words_note_block = [
        Paragraph("<b>Total In Words</b>", bold_small),
        Paragraph(_amount_to_words(invoice["total"]), small),
        Spacer(1, 6 * mm),
        Paragraph("<b>Note</b>", bold_small),
        Paragraph(_INVOICE_NOTE, small),
    ]
    bottom_table = Table([[words_note_block, totals_signature_table]], colWidths=[99 * mm, 68 * mm])
    bottom_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elements.append(bottom_table)
    elements.append(Spacer(1, 5 * mm))

    # ---- Bank details ----
    elements.append(Paragraph("<b>Payment Option</b>", bold_small))
    elements.append(Paragraph("Bank Account Details", small))
    elements.append(Paragraph(f"Bank Name: {_BANK['bank_name']}", small))
    elements.append(Paragraph(f"Account Name: {_BANK['account_name']}", small))
    elements.append(Paragraph(f"Account Number: {_BANK['account_number']}", small))
    elements.append(Paragraph(f"IFSC Code: {_BANK['ifsc']}", small))
    elements.append(Spacer(1, 4 * mm))

    # ---- Terms & Conditions ----
    # Admin-editable (Accounts > Terms & Condition), one shared block across
    # every invoice_type now — replaces the old hardcoded per-type
    # _TERMS_BY_TYPE dict. One bullet per non-blank line.
    elements.append(Paragraph("<b>Terms &amp; Condition</b>", bold_small))
    with get_connection() as connection:
        terms_content = _invoice_terms_content(connection)
    for line in terms_content.splitlines():
        line = line.strip()
        if line:
            elements.append(Paragraph(f"- {line}", small))
    elements.append(Spacer(1, 6 * mm))

    footer_style = ParagraphStyle("footer", parent=small, alignment=TA_CENTER, textColor=colors.HexColor("#999999"))
    elements.append(Paragraph("This is Computer Generated Document", footer_style))

    return elements


def _draw_page_border(canvas, _doc):
    # The reference invoices are framed by a single border rect sitting a
    # little outside the text margins (not drawn by any flowable above —
    # it's page decoration, added here via the page callback). Applied to
    # every page of a multi-invoice PDF too (onFirstPage/onLaterPages both
    # use this same callback), so each invoice's page gets its own border.
    canvas.saveState()
    canvas.setStrokeColor(colors.black)
    canvas.setLineWidth(0.5)
    x0, y0 = 17.7 * mm, 19.6 * mm
    x1, y1 = A4[0] - 17.7 * mm, A4[1] - 18.8 * mm
    canvas.rect(x0, y0, x1 - x0, y1 - y0, stroke=1, fill=0)
    canvas.restoreState()


def _build_invoices_pdf(invoices: list[dict[str, Any]]) -> bytes:
    """Renders one or more invoices into a single PDF, one starting on a
    fresh page after the next — used when an order has more than one
    invoice (see eStamp Bulk's Reimbursement + Invoice pair)."""
    elements: list[Any] = []
    for i, invoice in enumerate(invoices):
        if i > 0:
            elements.append(PageBreak())
        elements.extend(_invoice_pdf_elements(invoice))

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=24 * mm, bottomMargin=20 * mm, leftMargin=21.2 * mm, rightMargin=21.2 * mm,
    )
    doc.build(elements, onFirstPage=_draw_page_border, onLaterPages=_draw_page_border)
    return buffer.getvalue()


def _build_invoice_pdf(invoice: dict[str, Any]) -> bytes:
    return _build_invoices_pdf([invoice])


@router.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: UUID) -> StreamingResponse:
    invoice = get_invoice(invoice_id)
    pdf_bytes = _build_invoice_pdf(invoice)
    filename = invoice["invoice_number"].replace("/", "-") + ".pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
