"""
GET  /api/messages/{user_doc_id}   -> admin views the message thread for an order
POST /api/messages/admin/send      -> admin sends a message in that thread

User-facing endpoints (get_messages_user, user_send) from the original app
are not ported — B2C customers don't log into this app.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.doc_message import DocMessage
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/messages", tags=["messages"])


class AdminSendRequest(BaseModel):
    user_doc_id: int
    message: str


def _fmt(msg: DocMessage) -> dict:
    return {
        "id": msg.id,
        "sender_type": msg.sender_type,
        "message": msg.message,
        "created_at": msg.created_at.isoformat() if msg.created_at else "",
    }


def _ensure_system_message(user_doc_id: int, db: Session):
    exists = db.query(DocMessage).filter(
        DocMessage.user_doc_id == user_doc_id,
        DocMessage.sender_type == "system",
        DocMessage.message == "Document created",
    ).first()
    if not exists:
        db.add(DocMessage(user_doc_id=user_doc_id, sender_type="system", message="Document created"))
        db.commit()


@router.get("/{user_doc_id}")
def get_messages(user_doc_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    _ensure_system_message(user_doc_id, db)
    msgs = db.query(DocMessage).filter(DocMessage.user_doc_id == user_doc_id).order_by(DocMessage.created_at.asc()).all()
    return {"messages": [_fmt(m) for m in msgs]}


@router.post("/admin/send")
def admin_send(payload: AdminSendRequest, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == payload.user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    msg = DocMessage(user_doc_id=payload.user_doc_id, sender_type="admin", message=payload.message.strip())
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {"status": "ok", "message": _fmt(msg)}
