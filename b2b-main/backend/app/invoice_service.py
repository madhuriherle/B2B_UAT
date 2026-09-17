"""
Automatic invoice generation for real B2B orders (User Panel -> My Orders ->
View Order -> Download Invoice).

Reuses the Accounts module's invoice machinery end to end — the
b2b_invoices/b2b_invoice_items tables, the INV/26/27-0014 fiscal-year
numbering sequence, the Karnataka CGST+SGST vs out-of-state IGST rule, and
the ReportLab PDF builder that already matches the client's reference
templates (see app/routes/accounts.py) — rather than inventing a second
invoice pipeline. This module only adds the piece that didn't exist yet:
turning a real `orders` row into the (invoice_type, line items) that
_build_invoice_pdf expects, sourced from the order's own satellite tables
instead of a manually-typed Accounts form.

Rule (per product spec): exactly one invoice per order, chosen by whether the
order carries a stamp duty component (eStamp / eStamp Bulk) or not (every
other service). Reimbursement invoices are always a stamp-duty-only
pass-through (no GST); everything else is a single "Service Charge" line
taxed at the CGST+SGST/IGST split.
"""

from datetime import date
from decimal import Decimal
from io import BytesIO
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.database import get_connection, get_transaction
from app.notification_service import notify_invoice_generated
from app.routes.accounts import (
    _build_invoice_pdf,
    _build_invoices_pdf,
    _is_karnataka,
    _next_invoice_number,
    _with_totals,
    get_invoice,
)
from app.routes.partner import BULK_ESTAMP_SERVICE_NAME, get_partner_order_with_esign

STAMP_DUTY_DESCRIPTION = "Stamp Duty - Cost Recovery"

# Standard SAC code for "other professional, technical and business services"
# — the exact code the client's own reference Normal Invoice uses for its
# Service Charge line. Orders don't carry a per-service HSN/SAC of their own
# (no such column exists anywhere in the schema), so this one code is applied
# uniformly, the same way _COMPANY/_BANK in accounts.py are fixed constants
# rather than per-invoice input.
_SERVICE_HSN_SAC = "998599"

# The only GST rate configured anywhere in this codebase (quotations.py's
# `gst_percentage NUMERIC(5,2) DEFAULT 18` — see schema.sql). Orders/services
# have no GST rate of their own to read, so automatic invoices reuse this
# same default rather than inventing a second one.
DEFAULT_GST_PERCENTAGE = Decimal("18")


def _organization_bill_to(connection, organization_id: UUID) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT o.organization_name, o.address_line1, o.address_line2, o.city, o.pincode, o.gst_number, s.state_name
        FROM organizations o
        LEFT JOIN state s ON s.id = o.state_id
        WHERE o.id = %s
        """,
        (organization_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Organization not found")
    # b2b_invoices.bill_to_address is a single free-text snapshot column, so
    # the structured fields are flattened into one string at invoice time.
    address_parts = [row["address_line1"], row["address_line2"], row["city"], row["state_name"], row["pincode"]]
    address = ", ".join(part for part in address_parts if part) or None
    return {
        "name": row["organization_name"],
        "address": address,
        "state": row["state_name"],
        "gstin": row["gst_number"],
    }


def _stamp_item(*, qty: Any, rate: Any, amount: Any) -> dict[str, Any]:
    return {
        "description": STAMP_DUTY_DESCRIPTION,
        "hsn_sac": None,
        "qty": Decimal(str(qty)),
        "rate": Decimal(str(rate)),
        "cgst_percentage": Decimal("0"),
        "sgst_percentage": Decimal("0"),
        "igst_percentage": Decimal("0"),
        "amount": Decimal(str(amount)),
    }


def _tax_split(karnataka: bool) -> tuple[Decimal, Decimal, Decimal]:
    half = DEFAULT_GST_PERCENTAGE / 2
    return (half, half, Decimal("0")) if karnataka else (Decimal("0"), Decimal("0"), DEFAULT_GST_PERCENTAGE)


def _item_gst_amount(item: dict[str, Any]) -> Decimal:
    """The GST on one invoice line, from whichever percentages _tax_split
    already assigned it (0% for a _stamp_item, 18% split CGST+SGST/IGST for
    a _service_line) — the one shared calculation every GST-inclusive total
    below is built from, so none of them can drift from what the invoice
    itself displays (see _with_totals in accounts.py, same formula)."""
    return item["amount"] * (item["cgst_percentage"] + item["sgst_percentage"] + item["igst_percentage"]) / Decimal("100")


def _tax_inclusive_total(items: list[dict[str, Any]]) -> Decimal:
    return sum((item["amount"] + _item_gst_amount(item) for item in items), Decimal("0")).quantize(Decimal("0.01"))


def _service_line(description: str, amount: Decimal, karnataka: bool, *, hsn_sac: str | None = _SERVICE_HSN_SAC) -> dict[str, Any]:
    cgst, sgst, igst = _tax_split(karnataka)
    return {
        "description": description,
        "hsn_sac": hsn_sac,
        "qty": Decimal("1"),
        "rate": amount,
        "cgst_percentage": cgst,
        "sgst_percentage": sgst,
        "igst_percentage": igst,
        "amount": amount,
    }


def _resolve_order_invoice(connection, order: dict[str, Any], karnataka: bool) -> list[tuple[str, list[dict[str, Any]]]]:
    """Returns a list of (invoice_type, items) pairs for an order, applying
    the stamp-duty rule. Every order type generates exactly one pair, except
    eStamp Bulk which generates two — a Reimbursement invoice for the stamp
    face value AND a normal Invoice for service/delivery/documentation
    charges, both wallet-funded at completion (see
    partner.update_bulk_estamp_order_status). Raises 400 when the order's
    financial data isn't final yet (e.g. a single eStamp request that hasn't
    come back from SignDesk, or an eSign workflow still in progress) — an
    invoice must never be generated off a number that could still change.

    orders.stamp_value_wallet_debited (see schema.sql) splits eStamp/eStamp
    Bulk orders into two eras: orders placed under the new eStamp
    reimbursement wallet model have their real stamp value deducted from the
    wallet at completion (see update_bulk_estamp_order_status) and get a
    genuine per-order Reimbursement invoice for it right here, alongside the
    Invoice for whatever else was wallet-deducted (service fee / charges).
    Orders placed before this flag existed — or for PPS orgs, which never
    touch the wallet at all — keep the original single-Reimbursement-invoice
    behavior exactly as it was.
    """
    service_name = order["service_name"]
    new_wallet_model = bool(order.get("stamp_value_wallet_debited"))

    # An eStamp order can optionally have an eSign workflow attached to it
    # (see PartnerUserCreateOrder.jsx's "send for eSign after stamp" option,
    # which calls /orders/{id}/esign/initiate against this same order_id
    # after the stamp completes). Neither branch below has any awareness of
    # that attached eSign — both would happily invoice off the stamp alone
    # while the eSign is still in flight. Gate here, once, for both.
    if service_name == "eStamp":
        pending_esign = connection.execute(
            "SELECT status FROM b2b_esign_transaction WHERE order_id = %s", (order["id"],)
        ).fetchone()
        if pending_esign and pending_esign["status"] != "signed":
            raise HTTPException(status_code=400, detail="Complete the eSign step for this order before generating its invoice")

    if service_name == BULK_ESTAMP_SERVICE_NAME:
        # Nothing is charged (wallet or otherwise) until Super Admin marks the
        # order Completed (see partner.update_bulk_estamp_order_status) — so
        # stamp_value_wallet_debited is still false for a brand new wallet-model
        # order sitting at Pending/Processed, which would otherwise make this
        # function misread it as a pre-wallet-model order and generate a
        # premature/duplicate Reimbursement invoice for the stamp face value.
        if order["status"] != "Completed":
            raise HTTPException(status_code=400, detail="Complete this eStamp Bulk order before downloading its invoice")

        bulk = order.get("bulk_estamp") or {}
        results: list[tuple[str, list[dict[str, Any]]]] = []

        # Reimbursement invoice — the stamp face value, one line per
        # denomination actually ordered. Generated the same way regardless
        # of new_wallet_model: wallet-debited orgs and PPS orgs (which never
        # touch the wallet at all, billed per-service via invoice instead)
        # both still need this invoice to document the stamp value.
        items_src = bulk.get("items") or []
        if not items_src:
            raise HTTPException(status_code=400, detail="Stamp duty details are not available for this order yet")
        results.append((
            "Reimbursement",
            [
                _stamp_item(qty=item["quantity"], rate=item["denomination"], amount=item["face_value"])
                for item in items_src
            ],
        ))

        # Invoice — Service Fee plus every additional charge snapshotted onto
        # this order at creation time (order_charge — see
        # partner.create_bulk_estamp_order), whatever they're named: Service
        # Charge, Delivery Charge, Documentation Charge, any admin-defined
        # type. Never re-read from today's partner configuration, so a later
        # config change can't alter an already-generated invoice. Same for
        # every org regardless of payment mode — a PPS org was never
        # wallet-debited for these, so this invoice is its only bill for
        # them; a wallet org was already debited at completion (see
        # partner.update_bulk_estamp_order_status) and this invoice is its
        # receipt for that debit.
        service_items = []
        service_fee = Decimal(str(bulk.get("service_fee") or 0))
        if service_fee > 0:
            service_items.append(_service_line("Service Fee", service_fee, karnataka))

        order_charges = bulk.get("charges") or []
        if order_charges:
            for charge in order_charges:
                amount = Decimal(str(charge.get("price") or 0))
                if amount > 0:
                    service_items.append(_service_line(charge["charge_name"], amount, karnataka))
        else:
            # Orders placed before this generic mechanism existed never got
            # an order_charge row — they only have the legacy single
            # Delivery Charge column populated. Falling back to it here
            # keeps those orders' invoices unchanged. (A genuinely
            # charge-free new order also has an empty order_charges list and
            # a zero legacy column, so this fallback is a no-op for it
            # either way.)
            delivery_charge = Decimal(str(bulk.get("delivery_charge") or 0))
            if delivery_charge > 0:
                service_items.append(_service_line("Delivery Charge", delivery_charge, karnataka))

        if service_items:
            results.append(("Invoice", service_items))

        return results

    # "eStamp On The Fly" (Karnataka) shares b2b_stamp_transaction and the
    # same stamp_value_wallet_debited flag with plain eStamp — see
    # stamp_service.initiate_stamp_otf — so it needs the same pre-new-wallet-
    # model fallback path (relevant for PPS orgs, which never set that flag).
    if service_name in ("eStamp", "eStamp On The Fly") and not new_wallet_model:
        stamp = connection.execute(
            "SELECT status, stamp_duty_amount FROM b2b_stamp_transaction WHERE order_id = %s",
            (order["id"],),
        ).fetchone()
        if not stamp or stamp["status"] != "completed" or stamp["stamp_duty_amount"] is None:
            raise HTTPException(status_code=400, detail="Stamp duty has not been finalized for this order yet")
        amount = stamp["stamp_duty_amount"]
        return [("Reimbursement", [_stamp_item(qty=1, rate=amount, amount=amount)])]

    if service_name == "Manual eStamp":
        # Same reasoning as eStamp Bulk above — nothing is charged (wallet or
        # otherwise) until Super Admin marks the order Completed (see
        # partner.update_manual_estamp_order_status), so this must never
        # generate an invoice off a Pending/in-progress order's numbers.
        if order["status"] != "Completed":
            raise HTTPException(status_code=400, detail="Complete this Manual eStamp order before downloading its invoice")

        manual = order.get("manual_estamp") or {}
        items = []
        service_fee = Decimal(str(manual.get("service_fee") or 0))
        if service_fee > 0:
            items.append(_service_line("Service Fee", service_fee, karnataka))

        # Every additional charge snapshotted onto this order at creation
        # time (order_charge — see partner.create_manual_estamp_order).
        for charge in manual.get("charges") or []:
            charge_amount = Decimal(str(charge.get("price") or 0))
            if charge_amount > 0:
                items.append(_service_line(charge["charge_name"], charge_amount, karnataka))

        # eSign is billed the same way a plain eSign order is — never wallet
        # debited, recovered here via charged_amount (price × actually-signed
        # count), not the fixed price × signer-count estimate on order.amount.
        if manual.get("esign_required"):
            esign = order.get("esign") or {}
            esign_amount = Decimal(str(esign.get("charged_amount") or 0))
            if esign_amount > 0:
                items.append(_service_line("eSign Charge", esign_amount, karnataka))

        if not items:
            raise HTTPException(status_code=400, detail="Nothing to invoice for this order yet")
        return [("Invoice", items)]

    if order["status"] == "Draft":
        raise HTTPException(status_code=400, detail="Submit this order before downloading its invoice")

    if service_name == "eKYC":
        # Gated on a real verification outcome — 'Verified' (DigiLocker/PAN)
        # or 'Document Extracted' (terminal state for doc types with no
        # verification path, e.g. Passport) — same reasoning as eStamp
        # Bulk/Manual eStamp/eSign's Completed gates below: a Submitted eKYC
        # order's DigiLocker/PAN step may still be in flight or may fail, and
        # an invoice must never be generated off an outcome that could still
        # change. Verification success alone never charges anything — eKYC
        # has no Super Admin-driven "Completed" action, so its fee is only
        # ever deducted (like every other service's) via get_or_create_
        # invoice_for_order's charge_wallet param, from Super Admin's own
        # Generate Invoice click.
        if order["status"] not in ("Verified", "Document Extracted"):
            raise HTTPException(status_code=400, detail="Complete this order's eKYC verification before generating its invoice")

    if service_name == "eSign":
        # Gated on orders.status directly (not the derived esign.status_label)
        # — same single-source-of-truth pattern eStamp Bulk/Manual eStamp use
        # (see partner.update_bulk_estamp_order_status). Persisted the moment
        # every signer finishes (see esign_service._apply_signer_status),
        # never on a partial/intermediate signer event.
        if order["status"] != "Completed":
            raise HTTPException(status_code=400, detail="Complete the eSign workflow before downloading the invoice")
        esign = order.get("esign") or {}
        amount = esign.get("charged_amount") or 0
    else:
        # Covers plain services and, once new_wallet_model is true, single
        # eStamp orders too — order["amount"] there is the flat service fee
        # (never wallet-deducted under the new model), not the stamp value.
        amount = order["amount"]

    amount = Decimal(str(amount or 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Nothing to invoice for this order yet")

    return [("Invoice", [_service_line("Service Charge", amount, karnataka)])]


def get_order_pricing_preview(*, organization_id: UUID, order: dict[str, Any]) -> dict[str, Any] | None:
    """Non-mutating preview of what this order's invoice(s) would contain —
    the exact same items and CGST/SGST/IGST split _resolve_order_invoice
    computes for the real downloadable invoice, reused here purely for
    display (an Order Detail page's Pricing summary) without ever inserting
    a b2b_invoices row. Returns None when the order isn't far enough along
    yet for that function to compute a number (it raises HTTPException in
    that case — e.g. a Pending eStamp Bulk order, an eSign still in
    progress) — a Pricing card should degrade gracefully rather than error
    the whole page over data that simply doesn't exist yet.
    """
    with get_connection() as connection:
        bill_to = _organization_bill_to(connection, organization_id)
        karnataka = _is_karnataka(bill_to["state"])
        try:
            resolved = _resolve_order_invoice(connection, order, karnataka)
        except HTTPException:
            return None

    lines: list[dict[str, Any]] = []
    grand_total = Decimal("0")
    gst_total = Decimal("0")
    for _invoice_type, items in resolved:
        for item in items:
            gst = _item_gst_amount(item)
            lines.append({
                "description": item["description"],
                "amount": float(item["amount"]),
                "gst_amount": float(gst),
                "cgst_percentage": float(item["cgst_percentage"]),
                "sgst_percentage": float(item["sgst_percentage"]),
                "igst_percentage": float(item["igst_percentage"]),
            })
            grand_total += item["amount"] + gst
            gst_total += gst
    return {
        "lines": lines,
        "gst_amount": float(gst_total.quantize(Decimal("0.01"))),
        "total_payable": float(grand_total.quantize(Decimal("0.01"))),
    }


def get_or_create_invoice_for_order(
    *, order_id: UUID, organization_id: UUID, organization_user_id: UUID | None = None, charge_wallet: bool = False,
) -> list[dict[str, Any]]:
    """Returns every invoice this order needs — one for most order types,
    two for eStamp Bulk (Reimbursement + Invoice, see
    _resolve_order_invoice). Idempotent per (order_id, invoice_type): a
    repeat call (e.g. the "Download Invoice" button, clicked every time)
    finds each already-created invoice instead of duplicating it, and if an
    order somehow only has one of its two invoices so far, this call creates
    just the missing one rather than leaving it incomplete.

    charge_wallet=True additionally debits the wallet for the tax-inclusive
    total (see _tax_inclusive_total — GST is applicable to every state, always
    18%, split CGST+SGST for Karnataka vs IGST elsewhere; stamp-duty lines are
    still 0% GST, unaffected) of a NEWLY created "Invoice"-type document —
    never "Reimbursement",
    which is the stamp-value document and is instead handled entirely by
    the block-then-convert flow in partner.py (_block_wallet_amount/
    _convert_block_to_debit). This is the "service charge" deduction,
    guarded by orders.service_charge_wallet_debited so a repeat call never
    double-deducts, and skipped for PPS orgs same as every wallet touch
    elsewhere. Reserved for Super Admin-initiated callers — the manual
    "Generate Invoice" action and the various auto-generate-on-completion
    hooks all pass True; Partner User's own "Download Invoice" must never
    do so (see download_invoice_pdf_for_order, which no longer even calls
    this function for that reason — it only ever reads an invoice that
    already exists).
    """
    from app.routes.partner import _debit_wallet

    # Gathers everything needed to decide the invoice's shape (service_name,
    # amount, status, and — for eSign/eStamp Bulk — the sub-object with the
    # real per-signer/per-denomination numbers) through the exact same
    # function the Order Detail page itself uses, so an invoice can never
    # disagree with what the partner user already sees on screen.
    order = get_partner_order_with_esign(
        order_id=order_id, organization_id=organization_id, organization_user_id=organization_user_id,
    )

    with get_transaction() as connection:
        # Locks the order row so two concurrent Download Invoice clicks (or
        # any other duplicate trigger) can't both pass the "no invoice yet"
        # check below and insert two rows for the same (order, type) — the
        # second one just waits for the lock, then finds the first one's
        # invoice already there. service_charge_wallet_debited is read in
        # this same locked query so the charge_wallet guard below can never
        # race with itself either.
        locked = connection.execute(
            "SELECT id, service_charge_wallet_debited FROM orders WHERE id = %s FOR UPDATE", (order_id,)
        ).fetchone()
        if not locked:
            raise HTTPException(status_code=404, detail="Order not found")

        org_row = connection.execute(
            "SELECT payment_mode FROM organizations WHERE id = %s", (organization_id,)
        ).fetchone()
        payment_mode = (org_row["payment_mode"] if org_row else None) or "Wallet"

        bill_to = _organization_bill_to(connection, organization_id)
        karnataka = _is_karnataka(bill_to["state"])
        resolved = _resolve_order_invoice(connection, order, karnataka)

        invoice_ids: list[UUID] = []
        newly_created: list[str] = []  # invoice numbers, for notify below
        for invoice_type, items in resolved:
            existing = connection.execute(
                "SELECT id FROM b2b_invoices WHERE order_id = %s AND invoice_type = %s",
                (order_id, invoice_type),
            ).fetchone()
            if existing:
                invoice_ids.append(existing["id"])
                continue

            invoice_date = date.today()
            invoice_number = _next_invoice_number(connection, invoice_type, invoice_date)

            invoice_row = connection.execute(
                """
                INSERT INTO b2b_invoices (
                    invoice_number, order_id, invoice_type, invoice_date, due_date, terms,
                    bill_to_name, bill_to_address, bill_to_state, bill_to_gstin,
                    organization_id, organization_user_id
                )
                VALUES (
                    %(invoice_number)s, %(order_id)s, %(invoice_type)s, %(invoice_date)s, %(invoice_date)s,
                    'Due on Receipt', %(name)s, %(address)s, %(state)s, %(gstin)s,
                    %(organization_id)s, %(organization_user_id)s
                )
                RETURNING id
                """,
                {
                    "invoice_number": invoice_number,
                    "order_id": order_id,
                    "invoice_type": invoice_type,
                    "invoice_date": invoice_date,
                    "name": bill_to["name"],
                    "address": bill_to["address"],
                    "state": bill_to["state"],
                    "gstin": bill_to["gstin"],
                    "organization_id": organization_id,
                    "organization_user_id": order.get("organization_user_id"),
                },
            ).fetchone()
            invoice_id = invoice_row["id"]
            invoice_ids.append(invoice_id)
            newly_created.append(invoice_number)

            for item in items:
                connection.execute(
                    """
                    INSERT INTO b2b_invoice_items
                        (invoice_id, description, hsn_sac, qty, rate, cgst_percentage, sgst_percentage, igst_percentage, amount)
                    VALUES
                        (%(invoice_id)s, %(description)s, %(hsn_sac)s, %(qty)s, %(rate)s,
                         %(cgst_percentage)s, %(sgst_percentage)s, %(igst_percentage)s, %(amount)s)
                    """,
                    {**item, "invoice_id": invoice_id},
                )

            if (
                charge_wallet
                and invoice_type == "Invoice"
                and not locked["service_charge_wallet_debited"]
                and payment_mode != "PPS"
            ):
                service_charge_total = _tax_inclusive_total(items)
                if service_charge_total > 0:
                    _debit_wallet(
                        connection,
                        organization_id=organization_id, organization_user_id=order.get("organization_user_id"),
                        amount=float(service_charge_total), order_id=order_id,
                        description=f"Order {order['order_no']} · {order['service_name']} · Service Charge",
                    )
                connection.execute(
                    "UPDATE orders SET service_charge_wallet_debited = true WHERE id = %s", (order_id,)
                )

    # Notify once per invoice actually created this call, never on a re-fetch
    # of an already-existing one (the "Download Invoice" button calls this
    # same function every time, existing or not).
    for invoice_number in newly_created:
        notify_invoice_generated(
            organization_id=organization_id, order_id=order_id,
            order_no=order["order_no"], invoice_number=invoice_number,
        )

    return [get_invoice(iid) for iid in invoice_ids]


def get_or_create_reimbursement_invoice_for_wallet_credit(
    connection,
    *,
    organization_id: UUID,
    organization_user_id: UUID | None,
    amount: Decimal | float,
    wallet_transaction_id: UUID | None = None,
    organization_user_wallet_transaction_id: UUID | None = None,
) -> dict[str, Any]:
    """Generates the eStamp reimbursement invoice for a Super Admin wallet
    top-up (see app/routes/organizations.py's create_wallet_transaction) —
    separate from get_or_create_invoice_for_order's per-order Reimbursement
    invoices, which keep working completely unchanged for orders placed
    before this prefunded-wallet model (see orders.stamp_value_wallet_debited
    and _resolve_order_invoice's split above). Must be called with the same
    connection/transaction that performed the wallet credit, so a failed
    request never leaves a credited wallet with no invoice to show for it.
    Idempotent per wallet-credit event, same reasoning as the order_id unique
    index get_or_create_invoice_for_order relies on.
    """
    if wallet_transaction_id is None and organization_user_wallet_transaction_id is None:
        raise ValueError("wallet_transaction_id or organization_user_wallet_transaction_id is required")

    # Fetches through the SAME connection/transaction passed in, never a
    # fresh get_connection() (unlike accounts.get_invoice) — this function is
    # always called from inside the caller's still-open `with get_transaction()`
    # block (see organizations.create_wallet_transaction), so the row this
    # function just inserted isn't visible to any other connection yet.
    def _fetch(invoice_id: UUID) -> dict[str, Any]:
        invoice = connection.execute(
            """
            SELECT i.*,
                   COALESCE(c.company_name, i.bill_to_name) AS company_name,
                   COALESCE(c.address, i.bill_to_address) AS address,
                   c.city, COALESCE(c.state, i.bill_to_state) AS state, c.postal_code,
                   COALESCE(c.gstin, i.bill_to_gstin) AS gstin
            FROM b2b_invoices i
            LEFT JOIN b2b_customers c ON c.id = i.customer_id
            WHERE i.id = %s
            """,
            (invoice_id,),
        ).fetchone()
        items = connection.execute(
            "SELECT * FROM b2b_invoice_items WHERE invoice_id = %s ORDER BY id", (invoice_id,)
        ).fetchall()
        return _with_totals(invoice, items)

    existing = connection.execute(
        """
        SELECT id FROM b2b_invoices
        WHERE (wallet_transaction_id = %(wallet_transaction_id)s AND %(wallet_transaction_id)s::uuid IS NOT NULL)
           OR (organization_user_wallet_transaction_id = %(organization_user_wallet_transaction_id)s
               AND %(organization_user_wallet_transaction_id)s::uuid IS NOT NULL)
        """,
        {
            "wallet_transaction_id": wallet_transaction_id,
            "organization_user_wallet_transaction_id": organization_user_wallet_transaction_id,
        },
    ).fetchone()
    if existing:
        return _fetch(existing["id"])

    bill_to = _organization_bill_to(connection, organization_id)
    invoice_date = date.today()
    invoice_number = _next_invoice_number(connection, "Reimbursement", invoice_date)

    invoice_row = connection.execute(
        """
        INSERT INTO b2b_invoices (
            invoice_number, invoice_type, invoice_date, due_date, terms,
            bill_to_name, bill_to_address, bill_to_state, bill_to_gstin,
            organization_id, organization_user_id, wallet_transaction_id, organization_user_wallet_transaction_id
        )
        VALUES (
            %(invoice_number)s, 'Reimbursement', %(invoice_date)s, %(invoice_date)s, 'Due on Receipt',
            %(name)s, %(address)s, %(state)s, %(gstin)s,
            %(organization_id)s, %(organization_user_id)s, %(wallet_transaction_id)s, %(organization_user_wallet_transaction_id)s
        )
        RETURNING id
        """,
        {
            "invoice_number": invoice_number,
            "invoice_date": invoice_date,
            "name": bill_to["name"],
            "address": bill_to["address"],
            "state": bill_to["state"],
            "gstin": bill_to["gstin"],
            "organization_id": organization_id,
            "organization_user_id": organization_user_id,
            "wallet_transaction_id": wallet_transaction_id,
            "organization_user_wallet_transaction_id": organization_user_wallet_transaction_id,
        },
    ).fetchone()
    invoice_id = invoice_row["id"]

    item_amount = Decimal(str(amount))
    connection.execute(
        """
        INSERT INTO b2b_invoice_items
            (invoice_id, description, hsn_sac, qty, rate, cgst_percentage, sgst_percentage, igst_percentage, amount)
        VALUES
            (%(invoice_id)s, %(description)s, NULL, 1, %(amount)s, 0, 0, 0, %(amount)s)
        """,
        {"invoice_id": invoice_id, "description": "eStamp Reimbursement Wallet Funding", "amount": item_amount},
    )

    return _fetch(invoice_id)


def download_invoice_pdf_for_order(
    *, order_id: UUID, organization_id: UUID, organization_user_id: UUID | None = None
) -> StreamingResponse:
    """Partner User's own "Download Invoice" — read-only. Generating the
    Service Invoice (and the wallet deduction that now comes with it, see
    get_or_create_invoice_for_order's charge_wallet param) is reserved for
    Super Admin's own Generate Invoice action; a partner user's download
    click must never be able to trigger that. If nothing's been generated
    yet, this raises a clear "not generated yet" error instead of the old
    behavior of silently generating (and, now, charging) it on their behalf.
    Same organization_id/organization_user_id scoping rule as
    get_partner_order_with_esign: the order must belong to that org, and to
    that specific member when one is given.
    """
    with get_connection() as connection:
        order = connection.execute(
            """
            SELECT id FROM orders
            WHERE id = %(order_id)s AND organization_id = %(organization_id)s
              AND (%(organization_user_id)s::uuid IS NULL OR organization_user_id = %(organization_user_id)s::uuid)
            """,
            {"order_id": order_id, "organization_id": organization_id, "organization_user_id": organization_user_id},
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        invoice_ids = [
            row["id"] for row in connection.execute(
                "SELECT id FROM b2b_invoices WHERE order_id = %s", (order_id,)
            ).fetchall()
        ]
    if not invoice_ids:
        raise HTTPException(status_code=400, detail="Invoice not generated yet — contact your Super Admin.")

    invoices = [get_invoice(iid) for iid in invoice_ids]
    # Reimbursement (stamp value) before Invoice (charges) when an order has
    # both — matches the natural "what was the stamp worth, then what else
    # was charged" reading order. A single-invoice order (every type except
    # eStamp Bulk) is unaffected, there's only one to sort.
    invoices = sorted(invoices, key=lambda inv: 0 if inv["invoice_type"] == "Reimbursement" else 1)
    pdf_bytes = _build_invoices_pdf(invoices)
    if len(invoices) == 1:
        filename = invoices[0]["invoice_number"].replace("/", "-") + ".pdf"
    else:
        filename = "+".join(inv["invoice_number"].replace("/", "-") for inv in invoices) + ".pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Services whose Service Invoice now auto-generates itself the moment the
# order reaches its own Completed state (see partner.py's
# _auto_generate_bulk_estamp_invoice_on_completion /
# _auto_generate_manual_estamp_invoice_on_completion and
# esign_service._auto_generate_invoice_on_completion) — the only services
# list_invoices_for_user shows a derived "Pending" row for below. Everything
# else (Document Service, eKYC, ...) has no admin-controlled completion
# signal yet, so there's nothing reliable to show as "pending" for them.
_INVOICE_ELIGIBLE_SERVICES = ("eStamp Bulk", "Manual eStamp", "eSign")


def list_invoices_for_user(*, organization_id: UUID, organization_user_id: UUID | None) -> list[dict[str, Any]]:
    """Powers the User Portal's new Invoices page — both order-linked
    invoices (Reimbursement/Service) and wallet-recharge Reimbursement
    invoices (order_id NULL), scoped to this login. Only invoices created
    after organization_id/organization_user_id started being populated (see
    get_or_create_invoice_for_order and
    get_or_create_reimbursement_invoice_for_wallet_credit) are returned —
    older invoices predate those columns and simply won't match, which is
    fine since this is a brand new page with no prior expectations to honor.
    A member sees their own order invoices plus org-wide recharge invoices
    (organization_user_id IS NULL) — the shared eStamp funding pool their own
    orders draw from — but not another member's individual invoices.

    Also synthesizes a "Pending" row (status field only — never a real
    b2b_invoices row, see get_bulk_estamp_order_detail/
    get_manual_estamp_order_detail's invoice_number for the same
    derive-don't-store reasoning) for:
      - any order of an invoice-eligible service that hasn't reached
        Completed/generated its invoice yet, so the partner sees "this
        order's invoice isn't ready" instead of the order just silently not
        appearing here at all until it's done.
      - any wallet-recharge credit transaction that hasn't had its
        Reimbursement invoice generated yet — a recharge credits the wallet
        immediately (see organizations.create_wallet_transaction), but the
        invoice itself is a separate, later Super Admin action (see
        organizations.generate_wallet_transaction_invoice).
    """
    sql = """
        SELECT
            i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.due_date, i.created_at,
            i.order_id, ord.order_no, ord.service_name,
            COALESCE(SUM(it.amount), 0) AS subtotal,
            COALESCE(SUM(it.amount * it.cgst_percentage / 100), 0) AS cgst_amount,
            COALESCE(SUM(it.amount * it.sgst_percentage / 100), 0) AS sgst_amount,
            COALESCE(SUM(it.amount * it.igst_percentage / 100), 0) AS igst_amount
        FROM b2b_invoices i
        LEFT JOIN orders ord ON ord.id = i.order_id
        LEFT JOIN b2b_invoice_items it ON it.invoice_id = i.id
        WHERE i.organization_id = %(organization_id)s
          AND (%(organization_user_id)s::uuid IS NULL OR i.organization_user_id = %(organization_user_id)s::uuid
               OR i.organization_user_id IS NULL)
        GROUP BY i.id, i.order_id, ord.order_no, ord.service_name
        ORDER BY i.created_at DESC
    """
    pending_orders_sql = """
        SELECT o.id AS order_id, o.order_no, o.service_name, o.created_at
        FROM orders o
        WHERE o.organization_id = %(organization_id)s
          AND (%(organization_user_id)s::uuid IS NULL OR o.organization_user_id = %(organization_user_id)s::uuid)
          AND o.service_name = ANY(%(services)s)
          AND o.status != 'Draft'
          AND NOT EXISTS (SELECT 1 FROM b2b_invoices bi WHERE bi.order_id = o.id)
        ORDER BY o.created_at DESC
    """
    # Org-wide (organization_user_id IS NULL on wallet_transactions itself —
    # there's no per-member split at that table) — visible to every member,
    # same as a real org-level Reimbursement invoice already is above.
    pending_org_recharges_sql = """
        SELECT t.id AS transaction_id, t.amount, t.created_at
        FROM wallet_transactions t
        WHERE t.organization_id = %(organization_id)s AND t.type = 'credit'
          AND NOT EXISTS (SELECT 1 FROM b2b_invoices bi WHERE bi.wallet_transaction_id = t.id)
        ORDER BY t.created_at DESC
    """
    # A Retailer's own member-wallet recharge (see create_wallet_transaction's
    # _retailer_member_id special-case) — only this specific member's own.
    pending_member_recharges_sql = """
        SELECT t.id AS transaction_id, t.amount, t.created_at
        FROM organization_user_wallet_transactions t
        WHERE t.organization_user_id = %(organization_user_id)s AND t.type = 'credit'
          AND NOT EXISTS (SELECT 1 FROM b2b_invoices bi WHERE bi.organization_user_wallet_transaction_id = t.id)
        ORDER BY t.created_at DESC
    """
    with get_connection() as connection:
        rows = connection.execute(
            sql, {"organization_id": organization_id, "organization_user_id": organization_user_id}
        ).fetchall()
        pending_orders = connection.execute(
            pending_orders_sql,
            {
                "organization_id": organization_id,
                "organization_user_id": organization_user_id,
                "services": list(_INVOICE_ELIGIBLE_SERVICES),
            },
        ).fetchall()
        pending_recharges = connection.execute(
            pending_org_recharges_sql, {"organization_id": organization_id}
        ).fetchall()
        if organization_user_id is not None:
            pending_recharges += connection.execute(
                pending_member_recharges_sql, {"organization_user_id": organization_user_id}
            ).fetchall()

    for row in rows:
        row["total"] = row["subtotal"] + row["cgst_amount"] + row["sgst_amount"] + row["igst_amount"]
        row["status"] = "Generated"

    pending_rows = [
        {
            "id": None,
            "transaction_id": None,
            "invoice_number": None,
            "invoice_type": "Invoice",
            "invoice_date": None,
            "due_date": None,
            "created_at": order["created_at"],
            "order_id": order["order_id"],
            "order_no": order["order_no"],
            "service_name": order["service_name"],
            "subtotal": None, "cgst_amount": None, "sgst_amount": None, "igst_amount": None, "total": None,
            "status": "Pending",
        }
        for order in pending_orders
    ] + [
        {
            "id": None,
            # No order to key React's row list off of for a wallet-funding
            # entry (order_id is always None here) — the underlying credit
            # transaction id is the only thing unique per pending recharge.
            "transaction_id": txn["transaction_id"],
            "invoice_number": None,
            "invoice_type": "Reimbursement",
            "invoice_date": None,
            "due_date": None,
            "created_at": txn["created_at"],
            "order_id": None,
            "order_no": None,
            "service_name": None,
            "subtotal": None, "cgst_amount": None, "sgst_amount": None, "igst_amount": None,
            "total": txn["amount"],
            "status": "Pending",
        }
        for txn in pending_recharges
    ]

    # Pending and Generated used to be two blocks (every Pending row above
    # every Generated one, regardless of date) — merged and re-sorted here by
    # created_at so the newest activity of either kind is always on top, and
    # a newly generated invoice actually appears at the top instead of the
    # bottom of a long Pending block.
    all_rows = pending_rows + rows
    all_rows.sort(key=lambda r: r["created_at"], reverse=True)
    return all_rows


def _invoice_belongs_to_user(invoice: dict[str, Any], *, organization_id: UUID, organization_user_id: UUID | None) -> bool:
    if invoice.get("organization_id") != organization_id:
        return False
    invoice_user_id = invoice.get("organization_user_id")
    return invoice_user_id is None or invoice_user_id == organization_user_id


def _invoice_belongs_to_org(invoice: dict[str, Any], *, organization_id: UUID) -> bool:
    """Partner Portal's ownership check for a single invoice — unlike
    _invoice_belongs_to_user (User Portal, scoped to one member's own orders
    plus org-wide recharges), a Partner sees every invoice for their whole
    org regardless of which member's order it came from, matching
    list_invoices_for_user(organization_user_id=None)'s own "no member
    filter at all" behavior. Reusing _invoice_belongs_to_user with
    organization_user_id=None would NOT do this — it would incorrectly
    reject any invoice tied to a specific member's order."""
    return invoice.get("organization_id") == organization_id


def download_invoice_pdf(
    *, invoice_id: UUID, organization_id: UUID, organization_user_id: UUID | None
) -> StreamingResponse:
    """PDF download for the User Portal's Invoices page — covers both
    order-linked and wallet-recharge invoices (get_invoice/_build_invoice_pdf
    already handle either shape identically, see accounts.py)."""
    invoice = get_invoice(invoice_id)
    if not _invoice_belongs_to_user(invoice, organization_id=organization_id, organization_user_id=organization_user_id):
        raise HTTPException(status_code=404, detail="Invoice not found")

    pdf_bytes = _build_invoice_pdf(invoice)
    filename = invoice["invoice_number"].replace("/", "-") + ".pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def download_invoice_pdf_for_org(*, invoice_id: UUID, organization_id: UUID) -> StreamingResponse:
    """PDF download for the Partner Portal's own Invoices page — see
    _invoice_belongs_to_org for why this doesn't just call download_invoice_pdf
    with organization_user_id=None."""
    invoice = get_invoice(invoice_id)
    if not _invoice_belongs_to_org(invoice, organization_id=organization_id):
        raise HTTPException(status_code=404, detail="Invoice not found")

    pdf_bytes = _build_invoice_pdf(invoice)
    filename = invoice["invoice_number"].replace("/", "-") + ".pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
