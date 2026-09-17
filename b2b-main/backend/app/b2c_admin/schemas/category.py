from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class CategoryCreate(BaseModel):
    category_name: str


class CategoryUpdate(BaseModel):
    category_name: Optional[str] = None
    status: Optional[bool] = None


class CategoryResponse(BaseModel):
    category_id: UUID
    category_name: str
    status: bool

    created_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    modified_by: Optional[UUID] = None
    modified_at: Optional[datetime] = None

    class Config:
        from_attributes = True
