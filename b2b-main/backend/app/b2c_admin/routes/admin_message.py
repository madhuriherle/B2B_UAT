"""
POST /api/admin/message -> admin sends a message to a customer about their
order, logged as an open support request.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.support_request import SupportRequest
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/message", tags=["admin-message"])


class AdminMessageCreate(BaseModel):
    user_doc_id: int
    message: str


@router.post("")
def send_message(payload: AdminMessageCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    if not payload.message or not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    user_doc = db.query(UserDoc).filter(UserDoc.user_doc_id == payload.user_doc_id).first()
    if not user_doc:
        raise HTTPException(status_code=404, detail="Order not found")

    message = SupportRequest(
        user_id=user_doc.user_id,
        user_doc_id=payload.user_doc_id,
        message=payload.message.strip(),
        status="open",
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    return {"status": "ok", "message": "Message sent to customer", "id": str(message.id), "user_doc_id": payload.user_doc_id}
