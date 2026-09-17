"""
Admin Orders API
----------------
GET   /api/admin/orders                 -> paginated + filtered list
GET   /api/admin/orders/{id}            -> single order detail
PATCH /api/admin/orders/{id}/status     -> update doc_status
GET   /api/admin/orders/report/json     -> JSON report (date/status/type filters)
GET   /api/admin/orders/report/csv      -> CSV download

Covers the "Orders" tab. Document preview (HTML render) and mark-as-paid
(Razorpay capture verification) are deferred — not needed for read/display.

Gated by app.auth.get_current_admin (not the stricter
app.b2c_admin.deps.get_current_b2c_admin used elsewhere in this package) so
both B2B Super Admin ('admin') and Admin Portal ('platform_admin') can reach
it — this is the one slice of the B2C admin module Super Admin is meant to
see; the rest stays platform_admin-only.
"""

import csv
import io
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.b2c_admin.database import get_db
from app.b2c_admin.models.document import Document
from app.b2c_admin.models.invoice import Invoice
from app.b2c_admin.models.payment_transaction import PaymentTransaction
from app.b2c_admin.models.payment_transaction_meta import PaymentTransactionMeta
from app.b2c_admin.models.user import User
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/orders", tags=["admin-orders"])

NAME_CHANGE_DOC_ID = "f85eca7f-010e-4547-bf1e-74c718874cdd"

NAME_CHANGE_FIELDS = [
    {"key": "old_name", "label": "Old Name"},
    {"key": "new_name", "label": "New Name"},
    {"key": "guardian_name", "label": "Guardian Name"},
    {"key": "date_of_birth", "label": "Date of Birth"},
    {"key": "gender", "label": "Gender"},
    {"key": "address", "label": "Address"},
    {"key": "reason", "label": "Reason for Change"},
    {"key": "state", "label": "State"},
]

def _rental_fields(form: dict) -> list[dict]:
    """Rental Agreement field extraction, mirrored from the real doc-generation
    shape in templates_py/rental_agreement_template_en.py ({% set ll =
    data.landlords[0] ... %} etc.) — the form actually stores landlord/tenant
    as single-item lists ("landlords"/"tenants"), not singular "landlord"/
    "tenant" dicts, and rent terms live under "rental_details" and
    "agreement", not "rent". The previous key set (landlord.name, rent.*, ...)
    never matched real form_data, so those fields always showed "-" even on
    paid orders — only property.address/property.state worked, since
    "property" really is a plain dict."""
    ll = (form.get("landlords") or [{}])[0] or {}
    tn = (form.get("tenants") or [{}])[0] or {}
    pr = form.get("property") or {}
    rd = form.get("rental_details") or {}
    ag = form.get("agreement") or {}
    duration = " ".join(str(v) for v in (ag.get("duration_value"), ag.get("duration_unit")) if v) or "-"
    return [
        {"label": "Landlord Name", "value": ll.get("name") or "-"},
        {"label": "Landlord Phone", "value": ll.get("phone") or "-"},
        {"label": "Tenant Name", "value": tn.get("name") or "-"},
        {"label": "Tenant Phone", "value": tn.get("phone") or "-"},
        {"label": "Property Address", "value": pr.get("address") or "-"},
        {"label": "State", "value": pr.get("state") or "-"},
        {"label": "Monthly Rent", "value": rd.get("monthly_rent") or "-"},
        {"label": "Duration", "value": duration},
    ]


def _nested(d: dict, path: str):
    for k in path.split("."):
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


# Keys never worth showing as a "Document Field" on the Order Detail screen —
# either internal form-wizard state (status/current_index/editing_field) or
# already shown elsewhere (state).
_GENERIC_FIELD_EXCLUDE_KEYS = {"status", "current_index", "editing_field", "state"}


def _generic_fields(form: dict) -> list[dict]:
    """Fallback field list for any doc type without its own explicit FIELDS
    mapping below (e.g. "Affidavit for Change of Signature", or a future new
    document type) — renders whatever this specific order's form_data
    actually contains instead of a fixed list of labels that may not match
    this doc type's real fields at all (previously every non-Name-Change,
    non-Rental-Agreement order was shown Rental Agreement's field labels,
    which just showed "-" for everything since the keys never matched).
    Confirmed against real "Affidavit for Change of Signature" orders, which
    even have two slightly different field sets depending on which version
    of the template they were filled from — this adapts to either
    automatically rather than hardcoding one shape."""
    fields = []
    for key, value in form.items():
        if key in _GENERIC_FIELD_EXCLUDE_KEYS:
            continue
        if not isinstance(value, (str, int, float, bool)) or value in (None, ""):
            continue
        # Any base64 data URI (signature pad output, an uploaded photo, etc.)
        # regardless of what the field happens to be named — sniffed by
        # content, not by key name, since a field like "joint_photo" is just
        # as much an unreadable image blob as "signature" is, and there's no
        # reliable way to guess every such key name in advance. A plain long
        # string (no data: prefix) is still shown — that's real text data,
        # e.g. a long address — just capped so nothing runs the page's layout.
        if isinstance(value, str):
            if value.startswith("data:"):
                continue
            if len(value) > 300:
                value = value[:300] + "…"
        fields.append({"label": key.replace("_", " ").title(), "value": value})
    return fields


def _doc_type(doc: UserDoc, document: Document) -> str:
    if str(doc.doc_id) == NAME_CHANGE_DOC_ID:
        return "Name Change Affidavit"
    return document.doc_name if document else "Unknown"


def _payment_info(db: Session, user_doc_id: int) -> dict:
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.user_doc_id == user_doc_id)
        .order_by(desc(PaymentTransaction.id))
        .first()
    )
    if not txn:
        return {k: 0 for k in [
            "transaction_id", "doc_price", "stamp", "convenience_fee",
            "delivery_fee", "coupon_discount", "gst", "cgst", "sgst", "igst", "total",
        ]} | {"transaction_id": None, "created_at": ""}

    metas = db.query(PaymentTransactionMeta).filter(PaymentTransactionMeta.payment_id == txn.id).all()
    meta = {m.payment_meta_key: float(m.payment_meta_value or 0) for m in metas}

    cgst = float(txn.cgst_value or 0)
    sgst = float(txn.sgst_value or 0)
    igst = float(txn.igst_value or 0)

    return {
        "transaction_id": txn.id,
        "doc_price": float(txn.doc_price or 0),
        "stamp": meta.get("stamp", 0),
        "convenience_fee": meta.get("convenience_fee", 0),
        "delivery_fee": meta.get("delivery_fee", 0),
        "coupon_discount": meta.get("coupon_discount", 0),
        "gst": round(cgst + sgst + igst, 2),
        "cgst": cgst,
        "sgst": sgst,
        "igst": igst,
        "total": meta.get("total", 0),
        "created_at": txn.created_at.strftime("%d %b %Y %H:%M") if txn.created_at else "",
    }


@router.get("")
def list_orders(
    status: Optional[str] = Query(None, description="all | paid | unpaid | completed | in_progress"),
    doc_type: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: Optional[int] = Query(None, ge=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    if page is not None:
        skip = (page - 1) * limit

    q = db.query(UserDoc).order_by(desc(UserDoc.user_doc_id))

    if status == "paid":
        q = q.filter(UserDoc.payment_status == "success")
    elif status == "unpaid":
        q = q.filter(or_(UserDoc.payment_status != "success", UserDoc.payment_status.is_(None)))

    if date:
        try:
            date_filter = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
        q = q.filter(UserDoc.created_at >= date_filter).filter(UserDoc.created_at < date_filter + timedelta(days=1))

    if start_date:
        try:
            q = q.filter(UserDoc.created_at >= datetime.strptime(start_date, "%Y-%m-%d"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format; use YYYY-MM-DD")

    if end_date:
        try:
            q = q.filter(UserDoc.created_at < datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format; use YYYY-MM-DD")

    needs_python_filters = bool(search or state or doc_type or status in ("completed", "in_progress"))

    if needs_python_filters:
        docs = q.all()
        db_total = None
    else:
        db_total = q.count()
        docs = q.offset(skip).limit(limit).all()

    invoices_by_doc = {row.user_doc_id: row for row in db.query(Invoice).all()}

    result = []
    for doc in docs:
        form = doc.form_data or {}
        form_status = form.get("status", "in_progress")
        payment_status = doc.payment_status or "pending"
        doc_status = doc.doc_status or "draft"
        doc_state = doc.doc_state or "initiated"
        state_value = form.get("state") or _nested(form, "property.state") or ""

        user = db.query(User).filter(User.id == doc.user_id).first()
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        dtype = _doc_type(doc, document)
        payment = _payment_info(db, doc.user_doc_id)
        invoice = invoices_by_doc.get(doc.user_doc_id)

        if str(doc.doc_id) == NAME_CHANGE_DOC_ID:
            preview = form.get("new_name") or form.get("old_name") or "-"
        else:
            preview = ((form.get("landlords") or [{}])[0] or {}).get("name") or form.get("owner_name") or "-"

        if status and status != "all":
            if status == "paid" and payment_status != "success":
                continue
            elif status == "completed" and form_status != "completed":
                continue
            elif status == "in_progress" and form_status not in ("in_progress", "review", "editing"):
                continue

        if doc_type and doc_type != "all" and doc_type.lower() not in dtype.lower():
            continue

        if state and state != "all" and state.lower() not in state_value.lower():
            continue

        if search:
            s = search.lower()
            matched = any([
                s in (user.full_name or "").lower() if user else False,
                s in (user.email or "").lower() if user else False,
                s in dtype.lower(),
                s in str(doc.user_doc_id),
            ])
            if not matched:
                continue

        result.append({
            "user_doc_id": doc.user_doc_id,
            "document_name": dtype,
            "customer_name": user.full_name if user else "Unknown",
            "email": user.email if user else "-",
            "payment_status": payment_status,
            "payment_date": doc.paid_date.strftime("%d %b %Y") if doc.paid_date else None,
            "doc_state": doc_state,
            "created_date": doc.created_at.strftime("%d %b %Y") if doc.created_at else None,
            "modified_date": doc.modified_at.strftime("%d %b %Y") if doc.modified_at else None,
            "state": state_value or "-",
            "form_status": form_status,
            "doc_status": doc_status,
            "amount_paid": float(doc.amount_paid) if doc.amount_paid else float(payment["total"] or 0),
            "total": payment["total"],
            "preview": preview,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "is_editable": doc.doc_status not in ["completed", "delivered"],
            "payment": "Paid" if payment_status == "success" else "Not Paid",
            "status": doc_state,
            "invoice_id": invoice.id if invoice else None,
            "invoice_number": invoice.invoice_number if invoice else None,
        })

    total_count = len(result) if db_total is None else db_total
    return {
        "total": total_count,
        "skip": skip,
        "limit": limit,
        "orders": result[skip: skip + limit] if needs_python_filters else result,
    }


@router.get("/report/json")
def orders_report(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    q = db.query(UserDoc).order_by(desc(UserDoc.user_doc_id))

    if from_date:
        try:
            q = q.filter(UserDoc.created_at >= datetime.strptime(from_date, "%Y-%m-%d"))
        except ValueError:
            pass
    if to_date:
        try:
            q = q.filter(UserDoc.created_at < datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1))
        except ValueError:
            pass
    if status and status != "all":
        if status == "paid":
            q = q.filter(UserDoc.payment_status == "success")
        elif status == "completed":
            q = q.filter(UserDoc.doc_status == "completed")

    docs = q.all()
    report = []
    total_revenue = 0.0
    total_gst = 0.0

    for doc in docs:
        user = db.query(User).filter(User.id == doc.user_id).first()
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        dtype = _doc_type(doc, document)

        if doc_type and doc_type != "all" and doc_type.lower() not in dtype.lower():
            continue

        pay = _payment_info(db, doc.user_doc_id)
        total_revenue += pay["total"]
        total_gst += pay["gst"]

        report.append({
            "order_id": doc.user_doc_id,
            "user_name": user.full_name if user else "Unknown",
            "user_email": user.email if user else "-",
            "doc_type": dtype,
            "doc_price": pay["doc_price"],
            "stamp": pay["stamp"],
            "convenience_fee": pay["convenience_fee"],
            "delivery_fee": pay["delivery_fee"],
            "gst": pay["gst"],
            "total": pay["total"],
            "payment_status": doc.payment_status or "pending",
            "doc_status": doc.doc_status or "draft",
            "date": doc.created_at.strftime("%Y-%m-%d") if doc.created_at else "-",
        })

    return {
        "summary": {
            "total_orders": len(report),
            "total_revenue": round(total_revenue, 2),
            "total_gst": round(total_gst, 2),
            "paid_orders": sum(1 for r in report if r["payment_status"] == "success"),
        },
        "orders": report,
    }


@router.get("/report/csv")
def orders_report_csv(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    data = orders_report(from_date=from_date, to_date=to_date, status=status, doc_type=doc_type, db=db, current_user=current_user)
    orders = data["orders"]
    summary = data["summary"]

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["LegalDesk Orders Report"])
    if from_date or to_date:
        writer.writerow([f"Period: {from_date or 'All'} to {to_date or 'All'}"])
    writer.writerow([f"Generated: {datetime.now().strftime('%d %b %Y %H:%M')}"])
    writer.writerow([])
    writer.writerow(["SUMMARY"])
    writer.writerow(["Total Orders", summary["total_orders"]])
    writer.writerow(["Paid Orders", summary["paid_orders"]])
    writer.writerow(["Total Revenue", f"Rs.{summary['total_revenue']:.2f}"])
    writer.writerow(["Total GST", f"Rs.{summary['total_gst']:.2f}"])
    writer.writerow([])
    writer.writerow(["Order ID", "Customer Name", "Email", "Document Type", "Doc Fee (Rs)", "Stamp (Rs)", "Conv. Fee (Rs)", "Delivery (Rs)", "GST (Rs)", "Total (Rs)", "Payment Status", "Order Status", "Date"])
    for o in orders:
        writer.writerow([
            o["order_id"], o["user_name"], o["user_email"], o["doc_type"],
            f"{o['doc_price']:.2f}", f"{o['stamp']:.2f}", f"{o['convenience_fee']:.2f}", f"{o['delivery_fee']:.2f}",
            f"{o['gst']:.2f}", f"{o['total']:.2f}", o["payment_status"].upper(), o["doc_status"].upper(), o["date"],
        ])

    out.seek(0)
    filename = f"legaldesk_orders_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{user_doc_id}")
def get_order_detail(
    user_doc_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")

    user = db.query(User).filter(User.id == doc.user_id).first()
    document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
    form = doc.form_data or {}
    dtype = _doc_type(doc, document)
    payment = _payment_info(db, user_doc_id)
    invoice = db.query(Invoice).filter(Invoice.user_doc_id == user_doc_id).first()

    if str(doc.doc_id) == NAME_CHANGE_DOC_ID:
        fields = [{"label": f["label"], "value": form.get(f["key"], "-")} for f in NAME_CHANGE_FIELDS]
    elif dtype == "Rental Agreement":
        fields = _rental_fields(form)
    else:
        fields = _generic_fields(form)

    return {
        "user_doc_id": doc.user_doc_id,
        "user_name": user.full_name if user else "Unknown",
        "user_email": user.email if user else "-",
        "doc_type": dtype,
        "form_status": form.get("status", "in_progress"),
        "payment_status": doc.payment_status or "pending",
        "doc_status": doc.doc_status or "draft",
        "fields": fields,
        "form_data": form,
        "payment": payment,
        "state": form.get("state") or _nested(form, "property.state") or "-",
        "created_at": doc.created_at.strftime("%d %b %Y %H:%M") if doc.created_at else "-",
        "modified_at": doc.modified_at.strftime("%d %b %Y %H:%M") if doc.modified_at else "-",
        "paid_date": doc.paid_date.strftime("%d %b %Y %H:%M") if doc.paid_date else None,
        "invoice_id": invoice.id if invoice else None,
        "invoice_number": invoice.invoice_number if invoice else None,
    }


ALLOWED_STATUSES = {"processing", "completed", "delivered", "paid", "draft"}


class StatusUpdate(BaseModel):
    doc_status: str


@router.patch("/{user_doc_id}/status")
def update_order_status(
    user_doc_id: int,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    if body.doc_status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed values: {sorted(ALLOWED_STATUSES)}")
    doc.doc_status = body.doc_status
    doc.modified_by = current_user["id"]
    db.commit()
    return {"status": "updated", "user_doc_id": user_doc_id, "doc_status": body.doc_status}
