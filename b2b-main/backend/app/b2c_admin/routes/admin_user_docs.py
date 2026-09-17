"""
Admin User Documents API
------------------------
GET   /api/admin/user-docs         -> all user docs (search + filter + pagination)
GET   /api/admin/user-docs/{id}    -> single doc detail with full form_data
PATCH /api/admin/user-docs/{id}    -> update form_data fields (admin edit)

Covers the "User Documents" tab.
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.document import Document
from app.b2c_admin.models.user import User
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/user-docs", tags=["admin-user-docs"])

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


def _doc_type(doc: UserDoc, document: Document) -> str:
    if str(doc.doc_id) == NAME_CHANGE_DOC_ID:
        return "Name Change Affidavit"
    return document.doc_name if document else "Unknown"


@router.get("")
def list_user_docs(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    docs = db.query(UserDoc).order_by(desc(UserDoc.user_doc_id)).all()

    result = []
    for doc in docs:
        form = doc.form_data or {}
        user = db.query(User).filter(User.id == doc.user_id).first()
        document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
        dtype = _doc_type(doc, document)
        fstatus = form.get("status", "in_progress")

        if str(doc.doc_id) == NAME_CHANGE_DOC_ID:
            filled = sum(1 for f in NAME_CHANGE_FIELDS if form.get(f["key"]))
            total = len(NAME_CHANGE_FIELDS)
            preview = form.get("new_name") or form.get("old_name") or "-"
        else:
            filled = len([v for k, v in form.items() if k not in ("status", "language") and v])
            total = 0
            preview = ((form.get("landlords") or [{}])[0] or {}).get("name") or "-"

        if status and status != "all" and fstatus != status:
            continue
        if doc_type and doc_type != "all" and doc_type.lower() not in dtype.lower():
            continue
        if search:
            s = search.lower()
            matched = any([
                s in (user.full_name or "").lower() if user else False,
                s in (user.email or "").lower() if user else False,
                s in str(doc.user_doc_id),
                s in dtype.lower(),
            ])
            if not matched:
                continue

        result.append({
            "user_doc_id": doc.user_doc_id,
            "user_name": user.full_name if user else "Unknown",
            "user_email": user.email if user else "-",
            "doc_type": dtype,
            "status": fstatus,
            "payment_status": doc.payment_status or "pending",
            "doc_status": doc.doc_status or "draft",
            "filled_fields": filled,
            "total_fields": total,
            "preview": preview,
            "language": form.get("language", "english"),
            "created_at": doc.created_at.strftime("%d %b %Y") if doc.created_at else "-",
            "modified_at": doc.modified_at.strftime("%d %b %Y") if doc.modified_at else "-",
        })

    total_count = len(result)
    return {"total": total_count, "skip": skip, "limit": limit, "docs": result[skip: skip + limit]}


@router.get("/{user_doc_id}")
def get_user_doc_detail(user_doc_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    user = db.query(User).filter(User.id == doc.user_id).first()
    document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
    form = doc.form_data or {}
    dtype = _doc_type(doc, document)

    if str(doc.doc_id) == NAME_CHANGE_DOC_ID:
        fields = [{"label": f["label"], "value": form.get(f["key"], "-")} for f in NAME_CHANGE_FIELDS]
    else:
        fields = [{"label": k.replace("_", " ").title(), "value": str(v)} for k, v in form.items() if k not in ("status", "language") and v]

    return {
        "user_doc_id": doc.user_doc_id,
        "user_name": user.full_name if user else "Unknown",
        "user_email": user.email if user else "-",
        "doc_type": dtype,
        "status": form.get("status", "in_progress"),
        "payment_status": doc.payment_status or "pending",
        "doc_status": doc.doc_status or "draft",
        "language": form.get("language", "english"),
        "fields": fields,
        "form_data": form,
        "created_at": doc.created_at.strftime("%d %b %Y %H:%M") if doc.created_at else "-",
        "modified_at": doc.modified_at.strftime("%d %b %Y %H:%M") if doc.modified_at else "-",
        "paid_date": doc.paid_date.strftime("%d %b %Y %H:%M") if doc.paid_date else None,
    }


class UpdateFormDataRequest(BaseModel):
    form_data: dict[str, Any]


@router.patch("/{user_doc_id}")
def update_user_doc_form_data(user_doc_id: int, body: UpdateFormDataRequest, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    existing = doc.form_data or {}
    existing.update(body.form_data)
    doc.form_data = existing
    doc.modified_at = datetime.utcnow()

    db.commit()
    db.refresh(doc)
    return {"success": True, "user_doc_id": user_doc_id}
