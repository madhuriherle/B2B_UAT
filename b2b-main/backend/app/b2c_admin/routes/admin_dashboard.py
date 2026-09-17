"""
GET /api/admin/dashboard/summary
Returns top-level KPIs for the Admin Portal's B2C Overview section.
"""

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import cast, Date, func
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.document import Document
from app.b2c_admin.models.payment_transaction import PaymentTransaction
from app.b2c_admin.models.user import User
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/dashboard", tags=["admin-dashboard"])

NAME_CHANGE_DOC_ID = "f85eca7f-010e-4547-bf1e-74c718874cdd"


@router.get("/summary")
def dashboard_summary(
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    today = date.today()
    seven_days_ago = today - timedelta(days=6)

    total_revenue = float(
        db.query(func.coalesce(func.sum(UserDoc.amount_paid), 0))
        .filter(UserDoc.payment_status == "success")
        .scalar() or 0
    )
    today_revenue = float(
        db.query(func.coalesce(func.sum(UserDoc.amount_paid), 0))
        .filter(
            UserDoc.payment_status == "success",
            cast(UserDoc.paid_date, Date) == today,
        )
        .scalar() or 0
    )

    gst_rows = (
        db.query(
            func.coalesce(func.sum(PaymentTransaction.cgst_value), 0).label("cgst"),
            func.coalesce(func.sum(PaymentTransaction.sgst_value), 0).label("sgst"),
            func.coalesce(func.sum(PaymentTransaction.igst_value), 0).label("igst"),
        )
        .join(UserDoc, UserDoc.user_doc_id == PaymentTransaction.user_doc_id)
        .filter(UserDoc.payment_status == "success")
        .first()
    )
    total_gst = round(float(gst_rows.cgst or 0) + float(gst_rows.sgst or 0) + float(gst_rows.igst or 0), 2)

    total_orders = db.query(func.count(UserDoc.user_doc_id)).scalar() or 0
    orders_today = (
        db.query(func.count(UserDoc.user_doc_id))
        .filter(cast(UserDoc.created_at, Date) == today)
        .scalar() or 0
    )
    pending_orders = (
        db.query(func.count(UserDoc.user_doc_id))
        .filter(UserDoc.payment_status == "pending")
        .scalar() or 0
    )
    completed_orders = (
        db.query(func.count(UserDoc.user_doc_id))
        .filter(UserDoc.doc_state == "completed")
        .scalar() or 0
    )
    paid_orders = (
        db.query(func.count(UserDoc.user_doc_id))
        .filter(UserDoc.payment_status == "success")
        .scalar() or 0
    )

    revenue_rows = (
        db.query(
            cast(UserDoc.paid_date, Date).label("day"),
            func.coalesce(func.sum(UserDoc.amount_paid), 0).label("revenue"),
            func.count(UserDoc.user_doc_id).label("orders"),
        )
        .filter(
            UserDoc.payment_status == "success",
            cast(UserDoc.paid_date, Date) >= seven_days_ago,
        )
        .group_by(cast(UserDoc.paid_date, Date))
        .all()
    )
    rev_map = {str(r.day): {"revenue": float(r.revenue), "orders": int(r.orders)} for r in revenue_rows}

    revenue_last_7_days = [
        {
            "date": str(seven_days_ago + timedelta(days=i)),
            "revenue": rev_map.get(str(seven_days_ago + timedelta(days=i)), {}).get("revenue", 0),
            "orders": rev_map.get(str(seven_days_ago + timedelta(days=i)), {}).get("orders", 0),
        }
        for i in range(7)
    ]

    recent_raw = db.query(UserDoc).order_by(UserDoc.created_at.desc()).limit(5).all()
    recent_orders = []
    for doc in recent_raw:
        user = db.query(User).filter(User.id == doc.user_id).first()
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        doc_name = (
            "Name Change Affidavit" if str(doc.doc_id) == NAME_CHANGE_DOC_ID
            else (document.doc_name if document else "Unknown")
        )
        recent_orders.append({
            "id": doc.user_doc_id,
            "user_name": user.full_name if user else "Unknown",
            "user_email": user.email if user else "-",
            "document": doc_name,
            "amount": float(doc.amount_paid) if doc.amount_paid else 0.0,
            "payment_status": doc.payment_status or "pending",
            "doc_state": doc.doc_state or "initiated",
            "created_at": doc.created_at.strftime("%d %b %Y") if doc.created_at else "-",
        })

    return {
        "kpis": {
            "today_revenue": round(today_revenue, 2),
            "total_revenue": round(total_revenue, 2),
            "total_gst": total_gst,
            "total_orders": total_orders,
            "orders_today": orders_today,
            "pending_orders": pending_orders,
            "completed_orders": completed_orders,
            "paid_orders": paid_orders,
        },
        "revenue_last_7_days": revenue_last_7_days,
        "recent_orders": recent_orders,
    }
