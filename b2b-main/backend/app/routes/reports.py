from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_connection, get_transaction

router = APIRouter()


def _date_filters(prefix: str, date_from: date | None, date_to: date | None, params: dict[str, Any]) -> list[str]:
    filters = []
    if date_from:
        params["date_from"] = date_from
        filters.append(f"{prefix}.created_at::date >= %(date_from)s")
    if date_to:
        params["date_to"] = date_to
        filters.append(f"{prefix}.created_at::date <= %(date_to)s")
    return filters


# Statuses that already represent a dead end for an order — invoicing
# progress is meaningless for these, so the invoice-driven Pending/
# Processing/Completed relabel below (see list_order_reports) must never
# override them.
_TERMINAL_ORDER_STATUSES = {"Draft", "Failed", "Cancelled", "Rejected", "Expired"}


@router.get("/orders")
def list_order_reports(
    organization_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    # Local import — see get_order_report_detail's own local import below for
    # why (app.routes.partner <-> this module).
    from app.routes.partner import BULK_ESTAMP_SERVICE_NAME

    params: dict[str, Any] = {}
    filters = []
    if organization_id:
        params["organization_id"] = organization_id
        filters.append("o.organization_id = %(organization_id)s")
    filters += _date_filters("o", date_from, date_to, params)
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    sql = f"""
        SELECT
            o.id,
            o.order_no,
            org.organization_name AS partner_name,
            org.organization_type AS partner_type,
            u.full_name AS user_name,
            o.customer_name,
            o.service_name,
            o.amount,
            o.status,
            o.created_at,
            COALESCE(inv.invoice_count, 0) AS invoice_count
        FROM orders o
        JOIN organizations org ON org.id = o.organization_id
        LEFT JOIN organization_users ou ON ou.id = o.organization_user_id
        LEFT JOIN users u ON u.id = ou.user_id
        LEFT JOIN (
            SELECT order_id, COUNT(*) AS invoice_count
            FROM b2b_invoices
            WHERE order_id IS NOT NULL
            GROUP BY order_id
        ) inv ON inv.order_id = o.id
        {where}
        ORDER BY o.created_at DESC
    """
    with get_connection() as connection:
        rows = connection.execute(sql, params).fetchall()

    # Order Reports shows invoicing progress rather than each service's own
    # internal status vocabulary (Submitted/Verified/Stamp Processing/...,
    # see reports.py's investigation notes) — Pending until any invoice
    # exists, Processing once some but not all of the order's expected
    # invoices are generated, Completed once they all are. eStamp Bulk is the
    # only service that ever generates two invoices (Reimbursement + Invoice
    # — see invoice_service._resolve_order_invoice); everything else expects
    # exactly one, so those orders only ever show Pending or Completed.
    for row in rows:
        count = row.pop("invoice_count", 0) or 0
        if row["status"] not in _TERMINAL_ORDER_STATUSES:
            expected = 2 if row["service_name"] == BULK_ESTAMP_SERVICE_NAME else 1
            if count <= 0:
                row["status"] = "Pending"
            elif count < expected:
                row["status"] = "Processing"
            else:
                row["status"] = "Completed"
    return rows


# The single generic "View" target for every order on Order Reports,
# regardless of which service(s) it contains (eStamp Bulk/Manual eStamp/
# eStamp/eSign/plain service — see OrderDetail.jsx). ONE ORDER = ONE ORDER:
# this loads the order itself plus every satellite table that can hang off
# its order_id (service-specific detail, charges, invoices, wallet credits
# raised specifically to cover it) so the page can show the complete order —
# not a single service's processing screen — in one place. A service sub-key
# is None whenever this order never touched that service, so the frontend
# renders only the sections that actually apply instead of assuming a fixed
# service combo (an order can carry more than one — e.g. eStamp + eSign, see
# stamp_service.initiate_stamp / esign_service.initiate_esign).
@router.get("/orders/{order_id}")
def get_order_report_detail(order_id: UUID) -> dict[str, Any]:
    # Local import — app.routes.partner imports from app.routes.organizations
    # at module level, and importing it back from here at module level would
    # risk a future circular import; every other cross-module reuse in this
    # codebase (invoice_service, organizations.py) already does this the same
    # way for exactly that reason.
    from app.routes.partner import get_bulk_estamp_order_detail, get_manual_estamp_order_detail
    from app.invoice_service import _is_karnataka, _organization_bill_to, _resolve_order_invoice, _tax_split

    with get_connection() as connection:
        order = connection.execute(
            """
            SELECT o.id, o.order_no, o.organization_id, org.organization_name AS partner_name,
                   o.organization_user_id, COALESCE(u.full_name, org.organization_name) AS user_name,
                   o.customer_name, o.customer_email, o.customer_mobile,
                   o.service_name, o.amount, o.status, o.cancellation_reason, o.esign_price_per_signer, o.created_at
            FROM orders o
            JOIN organizations org ON org.id = o.organization_id
            LEFT JOIN organization_users ou ON ou.id = o.organization_user_id
            LEFT JOIN users u ON u.id = ou.user_id
            WHERE o.id = %s
            """,
            (order_id,),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        charges = connection.execute(
            "SELECT charge_name, price FROM order_charge WHERE order_id = %s ORDER BY charge_name ASC",
            (order_id,),
        ).fetchall()

        # Amount here is the invoice's real total (line items + GST), the
        # same number _with_totals/get_invoice would compute for the PDF —
        # summed in SQL rather than pulling in accounts.py's full machinery
        # just to show one figure per invoice on this list.
        invoices = connection.execute(
            """
            SELECT i.id AS invoice_id, i.invoice_number, i.invoice_type, i.invoice_date,
                   COALESCE(SUM(
                       it.amount + it.amount * it.cgst_percentage / 100
                       + it.amount * it.sgst_percentage / 100 + it.amount * it.igst_percentage / 100
                   ), 0) AS amount
            FROM b2b_invoices i
            LEFT JOIN b2b_invoice_items it ON it.invoice_id = i.id
            WHERE i.order_id = %s
            GROUP BY i.id, i.invoice_number, i.invoice_type, i.invoice_date
            ORDER BY (i.invoice_type = 'Invoice') DESC
            """,
            (order_id,),
        ).fetchall()

        financial_transactions = connection.execute(
            """
            SELECT t.id, t.type, t.amount, t.description, t.created_at,
                   (SELECT bi.invoice_number FROM b2b_invoices bi WHERE bi.wallet_transaction_id = t.id) AS invoice_number
            FROM wallet_transactions t
            WHERE t.order_id = %s

            UNION ALL

            SELECT t.id, t.type, t.amount, t.description, t.created_at,
                   (SELECT bi.invoice_number FROM b2b_invoices bi WHERE bi.organization_user_wallet_transaction_id = t.id) AS invoice_number
            FROM organization_user_wallet_transactions t
            WHERE t.order_id = %s

            ORDER BY created_at ASC
            """,
            (order_id, order_id),
        ).fetchall()

        # An eStamp order can optionally have eSign attached afterwards (see
        # stamp_service.initiate_stamp / esign_service.initiate_esign) — both
        # queries just return None when the order never touched that service,
        # so this stays generic instead of assuming a fixed service combo.
        stamp = connection.execute(
            "SELECT status, stamp_paper_number, stamp_duty_amount, error_message FROM b2b_stamp_transaction WHERE order_id = %s",
            (order_id,),
        ).fetchone()
        esign = connection.execute(
            "SELECT status FROM b2b_esign_transaction WHERE order_id = %s ORDER BY version DESC LIMIT 1",
            (order_id,),
        ).fetchone()

        # eStamp Bulk / Manual eStamp each have their own richer satellite
        # detail (denomination lines, party details, delivery address,
        # manual-processing sub-stages) — None when this order isn't that
        # service, same "derive, don't assume" rule as stamp/esign above.
        bulk_estamp = get_bulk_estamp_order_detail(order_id, connection=connection)
        manual_estamp = get_manual_estamp_order_detail(order_id, connection=connection)

        # Whether every invoice this order will ever need already exists —
        # the same resolution invoice_service.get_or_create_invoice_for_order
        # uses to decide what to create, run here read-only (never inserts)
        # so the Order Detail page can hide "Generate Invoice" once clicking
        # it could only ever produce "No new invoice to generate". karnataka
        # only affects the GST split on resolved items, never how many
        # invoice types come back, so a fixed value is fine for a count-only
        # check. An HTTPException here just means the order isn't invoiceable
        # yet (e.g. still in progress) — same as invoices_complete = False.
        #
        # A terminal status (_TERMINAL_ORDER_STATUSES — Draft/Failed/
        # Cancelled/Rejected/Expired) short-circuits straight to True instead:
        # nothing can ever be generated for a dead-ended order (a Failed
        # eSign/eStamp send, a Cancelled eStamp Bulk order, ...), so there's
        # no "still in progress, check back later" case to distinguish it
        # from — the button must simply never appear rather than invite an
        # admin to invoice something that never happened.
        if order["status"] in _TERMINAL_ORDER_STATUSES:
            invoices_complete = True
        else:
            try:
                resolved_types = _resolve_order_invoice(
                    connection, {**order, "esign": esign, "bulk_estamp": bulk_estamp, "manual_estamp": manual_estamp}, karnataka=False,
                )
                invoices_complete = len(invoices) >= len(resolved_types)
            except HTTPException:
                invoices_complete = False

        # eStamp Bulk's service/delivery/documentation charges are GST-exclusive
        # figures that the Service Invoice already taxes at generation time
        # (see invoice_service._resolve_order_invoice's bulk branch, which
        # runs every such charge through _service_line/_tax_split) — the
        # stamp face value itself is never taxed (_stamp_item hardcodes
        # 0% CGST/SGST/IGST). This exposes that same rate/split so the
        # Financial Summary below can preview the GST the eventual invoice
        # will carry, without duplicating or guessing the tax rule — it's
        # read from the exact same source, just before an invoice exists.
        service_charge_gst = None
        if bulk_estamp:
            bill_to = _organization_bill_to(connection, order["organization_id"])
            cgst, sgst, igst = _tax_split(_is_karnataka(bill_to["state"]))
            service_charge_gst = {
                "rate": cgst + sgst + igst, "cgst_percentage": cgst, "sgst_percentage": sgst, "igst_percentage": igst,
            }

        return {
            **order, "charges": charges, "invoices": invoices, "financial_transactions": financial_transactions,
            "stamp": stamp, "esign": esign, "bulk_estamp": bulk_estamp, "manual_estamp": manual_estamp,
            "invoices_complete": invoices_complete, "service_charge_gst": service_charge_gst,
        }


# Manual "Generate Invoice" action for the Order Detail page (OrderDetail.jsx)
# — covers BOTH invoice types (Service and Reimbursement) for ANY service,
# not just eStamp Bulk: invoice_service.get_or_create_invoice_for_order
# already resolves the right shape per service_name (see
# invoice_service._resolve_order_invoice) and is idempotent, so calling this
# again after the order is already fully invoiced is a harmless no-op rather
# than a duplicate. Auto-generation on completion (see
# partner._auto_generate_bulk_estamp_invoice_on_completion,
# esign_service._auto_generate_invoice_on_completion) already covers the
# happy path — this exists for the same reason
# organizations.generate_wallet_transaction_invoice does: a manual fallback
# for whenever that automatic step didn't fire (e.g. failed silently, or
# order completion predates this feature) instead of an invoice being
# permanently stuck "Pending" with nothing on screen to unstick it.
@router.post("/orders/{order_id}/generate-invoice")
def generate_order_invoice(order_id: UUID) -> list[dict[str, Any]]:
    # Local import — see get_order_report_detail's own local import above for
    # why (app.routes.partner <-> app.invoice_service <-> this module).
    from app.invoice_service import get_or_create_invoice_for_order

    with get_connection() as connection:
        order = connection.execute(
            "SELECT organization_id, organization_user_id FROM orders WHERE id = %s", (order_id,)
        ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    return get_or_create_invoice_for_order(
        order_id=order_id, organization_id=order["organization_id"], organization_user_id=order["organization_user_id"],
        charge_wallet=True,
    )


class CancelOrderPayload(BaseModel):
    reason: str


# Super Admin's generic Cancel Order action — the Actions column on Order
# Reports (OrderReports.jsx), works for any order/service/status (other than
# one already Cancelled). Deliberately distinct from two other, narrower
# cancel paths already in this codebase: partner.cancel_partner_order (a
# partner cancelling their OWN order, Draft/Submitted only, no reason
# collected) and the stamp-value services' own admin cancel buttons on
# OrderDetail.jsx (Pending/Processed only, no reason). For those same two
# stamp-value services this delegates to their existing functions instead of
# just flipping the status column here, so a blocked wallet amount still
# gets released correctly — everything else has no such pre-payment
# reservation to unwind, so a plain status update is enough.
@router.post("/orders/{order_id}/cancel")
def cancel_order_report(order_id: UUID, body: CancelOrderPayload) -> dict[str, Any]:
    from app.routes.partner import (
        BULK_ESTAMP_SERVICE_NAME, MANUAL_ESTAMP_SERVICE_NAME,
        cancel_bulk_estamp_order, cancel_manual_estamp_order,
    )

    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")

    with get_connection() as connection:
        order = connection.execute(
            "SELECT status, service_name FROM orders WHERE id = %s", (order_id,)
        ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] == "Cancelled":
        raise HTTPException(status_code=400, detail="This order is already cancelled")

    if order["service_name"] == BULK_ESTAMP_SERVICE_NAME:
        cancel_bulk_estamp_order(order_id, reason=reason)
    elif order["service_name"] == MANUAL_ESTAMP_SERVICE_NAME:
        cancel_manual_estamp_order(order_id, reason=reason)
    else:
        with get_transaction() as connection:
            connection.execute(
                "UPDATE orders SET status = 'Cancelled', cancellation_reason = %s, updated_at = now() WHERE id = %s",
                (reason, order_id),
            )

    return get_order_report_detail(order_id)


# Wallet-credit rows awaiting a Reimbursement invoice — surfaced on Order
# Reports (Super Admin's one-stop "things to process" list) instead of
# needing a trip into each partner's own Wallet screen. transaction_id/
# has_invoice below line up with the existing "Generate Invoice" action at
# POST /organizations/{organization_id}/wallet/transactions/{transaction_id}/
# generate-invoice (see organizations.generate_wallet_transaction_invoice),
# which already handles both the org-level and member-level (Retailer) table
# a given transaction_id may belong to — reused as-is from here.
#
# Excludes credits tagged with an order_id (see wallet_transactions.order_id
# in schema.sql): those were raised specifically to cover a short balance on
# a real order and are shown as part of that order's own detail page
# (partner.get_bulk_estamp_order_detail's wallet_reimbursements) instead of
# as their own standalone row here — otherwise the same funding event would
# show up twice: once correctly folded into its order, once as a phantom
# unlinked "order" of its own.
@router.get("/wallet-reimbursements")
def list_wallet_reimbursement_reports(
    organization_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {}
    org_filters = ["t.type = 'credit'", "t.order_id IS NULL"]
    member_filters = ["t.type = 'credit'", "t.order_id IS NULL"]
    if organization_id:
        params["organization_id"] = organization_id
        org_filters.append("t.organization_id = %(organization_id)s")
        member_filters.append("ou.organization_id = %(organization_id)s")
    org_filters += _date_filters("t", date_from, date_to, params)
    member_filters += _date_filters("t", date_from, date_to, params)

    sql = f"""
        SELECT t.id, t.organization_id, org.organization_name AS partner_name,
               org.organization_type AS partner_type, t.amount, t.description, t.created_at,
               EXISTS(SELECT 1 FROM b2b_invoices bi WHERE bi.wallet_transaction_id = t.id) AS has_invoice
        FROM wallet_transactions t
        JOIN organizations org ON org.id = t.organization_id
        WHERE {' AND '.join(org_filters)}

        UNION ALL

        SELECT t.id, ou.organization_id, org.organization_name AS partner_name,
               org.organization_type AS partner_type, t.amount, t.description, t.created_at,
               EXISTS(SELECT 1 FROM b2b_invoices bi WHERE bi.organization_user_wallet_transaction_id = t.id) AS has_invoice
        FROM organization_user_wallet_transactions t
        JOIN organization_users ou ON ou.id = t.organization_user_id
        JOIN organizations org ON org.id = ou.organization_id
        WHERE {' AND '.join(member_filters)}

        ORDER BY created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, params).fetchall()


# Shared by the Super Admin endpoint below and the partner-scoped endpoint in
# partner.py — same query, the only difference is who's allowed to set
# organization_id (admin: any org via query param; partner: forced to their own).
def get_sbtr_challan_reports(
    organization_id: UUID | None,
    date_from: date | None,
    date_to: date | None,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {}
    filters = []
    if organization_id:
        params["organization_id"] = organization_id
        filters.append("sc.organization_id = %(organization_id)s")
    filters += _date_filters("sc", date_from, date_to, params)
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    sql = f"""
        SELECT
            sc.id,
            sc.gtn_number,
            sc.challan_number,
            org.organization_name AS partner_name,
            u.full_name AS user_name,
            sc.customer_name,
            sc.address,
            s.state_name,
            sc.status,
            sc.created_at
        FROM sbtr_challans sc
        JOIN organizations org ON org.id = sc.organization_id
        LEFT JOIN organization_users ou ON ou.id = sc.organization_user_id
        LEFT JOIN users u ON u.id = ou.user_id
        LEFT JOIN state s ON s.id = sc.state_id
        {where}
        ORDER BY sc.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, params).fetchall()


@router.get("/sbtr-challans")
def list_sbtr_challan_reports(
    organization_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict[str, Any]]:
    return get_sbtr_challan_reports(organization_id, date_from, date_to)
