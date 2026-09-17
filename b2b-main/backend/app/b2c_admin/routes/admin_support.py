"""
Admin Support Requests API
--------------------------
GET /api/admin/support-requests             -> list all requests
GET /api/admin/support-requests/{id}        -> single request
PUT /api/admin/support-requests/{id}/status -> update status (open / resolved)

Covers the "Support Requests" tab. Only the admin half is ported — the
original app's user-facing submission endpoint has no caller in this merge;
B2C customers don't log into this app.
"""

from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.support_request import SupportRequest
from app.b2c_admin.models.user import User

admin_router = APIRouter(prefix="/api/admin/support-requests", tags=["admin-support"])


class StatusUpdate(BaseModel):
    status: str  # "open" | "resolved"


@admin_router.get("")
def list_support_requests(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    q = db.query(SupportRequest).order_by(desc(SupportRequest.created_at))
    if status in ("open", "resolved"):
        q = q.filter(SupportRequest.status == status)
    requests = q.all()

    result = []
    for r in requests:
        user = db.query(User).filter(User.id == r.user_id).first()
        result.append({
            "id": str(r.id),
            "user_id": str(r.user_id),
            "user_name": user.full_name if user else "Unknown",
            "user_email": user.email if user else "-",
            "user_doc_id": r.user_doc_id,
            "message": r.message,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return result


@admin_router.get("/{request_id}")
def get_support_request(request_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    r = db.query(SupportRequest).filter(SupportRequest.id == request_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Support request not found")

    user = db.query(User).filter(User.id == r.user_id).first()
    return {
        "id": str(r.id),
        "user_id": str(r.user_id),
        "user_name": user.full_name if user else "Unknown",
        "user_email": user.email if user else "-",
        "user_doc_id": r.user_doc_id,
        "message": r.message,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@admin_router.put("/{request_id}/status")
def update_support_status(request_id: UUID, payload: StatusUpdate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    if payload.status not in ("open", "resolved"):
        raise HTTPException(status_code=400, detail="Status must be 'open' or 'resolved'")

    r = db.query(SupportRequest).filter(SupportRequest.id == request_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Support request not found")

    r.status = payload.status
    db.commit()
    return {"id": str(r.id), "status": r.status}
