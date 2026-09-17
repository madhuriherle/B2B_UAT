from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class DocumentCreate(BaseModel):
    doc_name: str
    category_id: UUID
    lang: str
    price: Optional[Decimal] = None
    actual_price: Optional[Decimal] = None
    is_stamp_allowed: Optional[bool] = False
    is_review_required: Optional[bool] = False
    is_notary_allowed: Optional[bool] = False
    esign_allowed: Optional[bool] = False
    payment_status: Optional[str] = "pending"
    is_locked: Optional[bool] = False


class DocumentUpdate(BaseModel):
    doc_name: Optional[str] = None
    category_id: Optional[UUID] = None
    lang: Optional[str] = None
    price: Optional[Decimal] = None
    actual_price: Optional[Decimal] = None
    is_stamp_allowed: Optional[bool] = None
    is_review_required: Optional[bool] = None
    is_notary_allowed: Optional[bool] = None
    esign_allowed: Optional[bool] = None
    payment_status: Optional[str] = None
    is_locked: Optional[bool] = None
    status: Optional[bool] = None


class DocumentResponse(BaseModel):
    doc_id: UUID
    doc_name: str
    category_id: UUID
    lang: str
    price: Optional[Decimal] = None
    actual_price: Optional[Decimal] = None
    is_stamp_allowed: bool
    is_review_required: bool
    is_notary_allowed: bool
    esign_allowed: bool
    payment_status: str
    is_locked: bool
    status: bool

    created_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    modified_by: Optional[UUID] = None
    modified_at: Optional[datetime] = None

    class Config:
        from_attributes = True
