"""
Admin B2C Customers API
-----------------------
GET /api/admin/b2c-customers          -> list of registered B2C customers,
                                          auto-derived from their order history
                                          (a B2C "customer" is any user with
                                          at least one user_doc row — the
                                          shared `users.role` value overlaps
                                          with B2B's own "member" role, so
                                          role alone can't distinguish them).
GET /api/admin/b2c-customers/{user_id} -> profile: basic info + order history

Covers the "B2C Customers" screen and its profile drill-down.

Gated by app.auth.get_current_admin (not the stricter
app.b2c_admin.deps.get_current_b2c_admin used elsewhere in this package) so
both B2B Super Admin ('admin') and Admin Portal ('platform_admin') can reach
it — alongside Orders/Reports, this is part of the B2C admin module Super
Admin is meant to see; the rest stays platform_admin-only.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.b2c_admin.database import get_db
from app.b2c_admin.models.document import Document
from app.b2c_admin.models.user import User
from app.b2c_admin.models.user_details import UserDetails
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/b2c-customers", tags=["b2c-customers"])


@router.get("")
def list_customers(db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_admin)):
    rows = (
        db.query(
            UserDoc.user_id,
            func.count(UserDoc.user_doc_id).label("total_orders"),
            func.coalesce(func.sum(UserDoc.amount_paid), 0).label("total_spent"),
            func.max(UserDoc.created_at).label("last_order_at"),
        )
        .group_by(UserDoc.user_id)
        .all()
    )

    result = []
    for row in rows:
        user = db.query(User).filter(User.id == row.user_id).first()
        details = db.query(UserDetails).filter(UserDetails.user_id == row.user_id).first()
        result.append({
            "user_id": str(row.user_id),
            "name": (user.full_name if user else None) or (details.name if details else None) or "Unknown",
            "email": user.email if user else "-",
            "mobile": details.mobile if details else None,
            "total_orders": int(row.total_orders),
            "total_spent": float(row.total_spent or 0),
            "last_order_at": row.last_order_at.isoformat() if row.last_order_at else None,
        })

    result.sort(key=lambda c: c["last_order_at"] or "", reverse=True)
    return result


@router.get("/{user_id}")
def get_customer_profile(user_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Customer not found")

    details = db.query(UserDetails).filter(UserDetails.user_id == user_id).first()
    docs = db.query(UserDoc).filter(UserDoc.user_id == user_id).order_by(UserDoc.created_at.desc()).all()

    orders = []
    total_spent = 0.0
    for doc in docs:
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        amount = float(doc.amount_paid or 0)
        total_spent += amount
        orders.append({
            "user_doc_id": doc.user_doc_id,
            "document_name": document.doc_name if document else "Unknown",
            "amount_paid": amount,
            "payment_status": doc.payment_status or "pending",
            "doc_status": doc.doc_status or "draft",
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
        })

    return {
        "user_id": str(user.id),
        "name": user.full_name or (details.name if details else None) or "Unknown",
        "email": user.email,
        "mobile": details.mobile if details else None,
        "address": details.address if details else None,
        "city": details.city if details else None,
        "state": details.state if details else None,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "total_orders": len(orders),
        "total_spent": round(total_spent, 2),
        "orders": orders,
    }
