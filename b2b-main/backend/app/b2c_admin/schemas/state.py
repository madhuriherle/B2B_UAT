from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class StateCreate(BaseModel):
    state_name: str
    language_name: Optional[str] = None
    is_active: Optional[bool] = True


class StateUpdate(BaseModel):
    state_name: Optional[str] = None
    language_name: Optional[str] = None
    is_active: Optional[bool] = None


class StateResponse(BaseModel):
    id: UUID
    state_name: str
    language_name: Optional[str] = None
    is_active: bool

    created_by: Optional[UUID] = None
    created_at: Optional[datetime] = None
    modified_by: Optional[UUID] = None
    modified_at: Optional[datetime] = None

    class Config:
        from_attributes = True
