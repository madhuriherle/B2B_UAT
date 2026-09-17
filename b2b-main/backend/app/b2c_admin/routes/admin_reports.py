"""
Admin Reports API
-----------------
GET /api/admin/reports/financial      -> revenue, GST, fee breakdown by period
GET /api/admin/reports/orders         -> order volume breakdown by doc type / status
GET /api/admin/reports/financial/csv

Covers the "Reports" tab. All endpoints accept: from_date, to_date
(YYYY-MM-DD), doc_type, status.

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

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import cast, Date, desc, func
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.b2c_admin.database import get_db
from app.b2c_admin.models.document import Document
from app.b2c_admin.models.payment_transaction import PaymentTransaction
from app.b2c_admin.models.payment_transaction_meta import PaymentTransactionMeta
from app.b2c_admin.models.user import User
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/reports", tags=["admin-reports"])

NAME_CHANGE_DOC_ID = "f85eca7f-010e-4547-bf1e-74c718874cdd"


def _apply_date_filter(q, from_date, to_date):
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
    return q


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
        return {k: 0.0 for k in ["doc_price", "stamp", "convenience_fee", "delivery_fee", "coupon_discount", "gst", "cgst", "sgst", "igst", "total"]}
    metas = db.query(PaymentTransactionMeta).filter(PaymentTransactionMeta.payment_id == txn.id).all()
    meta = {m.payment_meta_key: float(m.payment_meta_value or 0) for m in metas}
    cgst = float(txn.cgst_value or 0)
    sgst = float(txn.sgst_value or 0)
    igst = float(txn.igst_value or 0)
    return {
        "doc_price": float(txn.doc_price or 0),
        "stamp": meta.get("stamp", 0),
        "convenience_fee": meta.get("convenience_fee", 0),
        "delivery_fee": meta.get("delivery_fee", 0),
        "coupon_discount": meta.get("coupon_discount", 0),
        "gst": round(cgst + sgst + igst, 2),
        "cgst": cgst, "sgst": sgst, "igst": igst,
        "total": meta.get("total", 0),
    }


def _build_financial_rows(db, from_date, to_date, doc_type, status):
    q = db.query(UserDoc).order_by(desc(UserDoc.user_doc_id))
    q = _apply_date_filter(q, from_date, to_date)
    if status and status != "all":
        if status == "paid":
            q = q.filter(UserDoc.payment_status == "success")
        elif status == "completed":
            q = q.filter(UserDoc.doc_status == "completed")
    docs = q.all()

    rows = []
    total_revenue = total_gst = total_stamp = total_conv = total_delivery = total_coupon = 0.0

    for doc in docs:
        user = db.query(User).filter(User.id == doc.user_id).first()
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        dtype = _doc_type(doc, document)

        if doc_type and doc_type != "all" and doc_type.lower() not in dtype.lower():
            continue

        pay = _payment_info(db, doc.user_doc_id)
        total_revenue += pay["total"]
        total_gst += pay["gst"]
        total_stamp += pay["stamp"]
        total_conv += pay["convenience_fee"]
        total_delivery += pay["delivery_fee"]
        total_coupon += pay["coupon_discount"]

        rows.append({
            "order_id": doc.user_doc_id,
            "date": doc.created_at.strftime("%Y-%m-%d") if doc.created_at else "-",
            "user_name": user.full_name if user else "Unknown",
            "user_email": user.email if user else "-",
            "doc_type": dtype,
            "doc_price": pay["doc_price"], "stamp": pay["stamp"],
            "convenience_fee": pay["convenience_fee"], "delivery_fee": pay["delivery_fee"],
            "coupon_discount": pay["coupon_discount"],
            "cgst": pay["cgst"], "sgst": pay["sgst"], "igst": pay["igst"], "gst": pay["gst"],
            "total": pay["total"],
            "payment_status": doc.payment_status or "pending",
        })

    summary = {
        "total_orders": len(rows),
        "paid_orders": sum(1 for r in rows if r["payment_status"] == "success"),
        "total_revenue": round(total_revenue, 2),
        "total_gst": round(total_gst, 2),
        "total_stamp": round(total_stamp, 2),
        "total_conv_fee": round(total_conv, 2),
        "total_delivery": round(total_delivery, 2),
        "total_discount": round(total_coupon, 2),
        "net_revenue": round(total_revenue - total_gst, 2),
    }
    return summary, rows


@router.get("/financial")
def financial_report(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    summary, rows = _build_financial_rows(db, from_date, to_date, doc_type, status)
    return {"summary": summary, "rows": rows}


@router.get("/financial/csv")
def financial_report_csv(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    summary, rows = _build_financial_rows(db, from_date, to_date, doc_type, status)

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["LegalDesk Financial Report"])
    writer.writerow([f"Period: {from_date or 'All'} to {to_date or 'All'}"])
    writer.writerow([f"Generated: {datetime.now().strftime('%d %b %Y %H:%M')}"])
    writer.writerow([])
    writer.writerow(["SUMMARY"])
    for k, v in summary.items():
        writer.writerow([k.replace("_", " ").title(), v])
    writer.writerow([])
    writer.writerow(["Order ID", "Date", "Customer", "Email", "Doc Type", "Doc Price", "Stamp", "Conv. Fee", "Delivery", "Discount", "CGST", "SGST", "IGST", "Total GST", "Total", "Payment Status"])
    for r in rows:
        writer.writerow([
            r["order_id"], r["date"], r["user_name"], r["user_email"], r["doc_type"],
            f"{r['doc_price']:.2f}", f"{r['stamp']:.2f}", f"{r['convenience_fee']:.2f}", f"{r['delivery_fee']:.2f}",
            f"{r['coupon_discount']:.2f}", f"{r['cgst']:.2f}", f"{r['sgst']:.2f}", f"{r['igst']:.2f}",
            f"{r['gst']:.2f}", f"{r['total']:.2f}", r["payment_status"].upper(),
        ])

    out.seek(0)
    fname = f"legaldesk_financial_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.get("/orders")
def orders_volume_report(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_admin),
):
    q = db.query(UserDoc)
    q = _apply_date_filter(q, from_date, to_date)
    docs = q.all()

    by_type = {}
    # Seeded with the real payment_status values this column actually takes
    # ("success"/"pending"/"failed") — "completed" is layered in separately
    # below from doc_status, not payment_status. Previously seeded "paid"
    # here, which payment_status never actually holds (real success rows use
    # "success"), so it always reported a dead 0 row alongside the real count.
    by_status = {"success": 0, "pending": 0, "failed": 0, "completed": 0, "draft": 0}

    for doc in docs:
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        dtype = _doc_type(doc, document)

        entry = by_type.setdefault(dtype, {"doc_type": dtype, "count": 0, "revenue": 0.0})
        entry["count"] += 1
        entry["revenue"] += float(doc.amount_paid or 0)

        ps = doc.payment_status or "pending"
        by_status[ps] = by_status.get(ps, 0) + 1

        ds = doc.doc_status or "draft"
        if ds == "completed":
            by_status["completed"] = by_status.get("completed", 0) + 1

    today = datetime.utcnow().date()
    thirty_ago = today - timedelta(days=29)
    daily_rows = (
        db.query(cast(UserDoc.created_at, Date).label("day"), func.count(UserDoc.user_doc_id).label("count"))
        .filter(cast(UserDoc.created_at, Date) >= thirty_ago)
        .group_by(cast(UserDoc.created_at, Date))
        .order_by(cast(UserDoc.created_at, Date))
        .all()
    )
    day_map = {str(r.day): int(r.count) for r in daily_rows}
    daily_trend = [{"date": str(thirty_ago + timedelta(days=i)), "orders": day_map.get(str(thirty_ago + timedelta(days=i)), 0)} for i in range(30)]

    return {
        "by_doc_type": sorted(by_type.values(), key=lambda x: -x["count"]),
        "by_status": by_status,
        "daily_trend": daily_trend,
        "total_orders": len(docs),
    }
