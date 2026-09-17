from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.document import Document
from app.b2c_admin.schemas.document import DocumentCreate, DocumentResponse, DocumentUpdate

router = APIRouter(prefix="/api/admin/documents", tags=["admin-documents"])


@router.get("", response_model=List[DocumentResponse])
def get_documents(db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    return db.query(Document).all()


@router.get("/{doc_id}", response_model=DocumentResponse)
def get_document(doc_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    document = db.query(Document).filter(Document.doc_id == doc_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.post("", response_model=DocumentResponse)
def create_document(data: DocumentCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    document = Document(**data.dict(), created_by=current_user["id"])
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.put("/{doc_id}", response_model=DocumentResponse)
def update_document(doc_id: UUID, data: DocumentUpdate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    document = db.query(Document).filter(Document.doc_id == doc_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    for field, value in data.dict(exclude_unset=True).items():
        setattr(document, field, value)

    document.modified_by = current_user["id"]
    db.commit()
    db.refresh(document)
    return document


@router.delete("/{doc_id}")
def delete_document(doc_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    document = db.query(Document).filter(Document.doc_id == doc_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    db.delete(document)
    db.commit()
    return {"message": "Document deleted successfully"}
