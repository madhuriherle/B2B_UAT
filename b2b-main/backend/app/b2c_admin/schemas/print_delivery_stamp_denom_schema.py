from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class PrintDeliveryStampDenomCreate(BaseModel):
    print_delivery_service_id: int
    stamp_denom_id: UUID
    status: Optional[bool] = True


class PrintDeliveryStampDenomUpdate(BaseModel):
    status: Optional[bool] = None


class PrintDeliveryStampDenomResponse(BaseModel):
    id: int
    print_delivery_service_id: int
    stamp_denom_id: UUID
    status: bool
    created_at: datetime
    created_by: Optional[UUID] = None
    modified_at: Optional[datetime] = None
    modified_by: Optional[UUID] = None

    class Config:
        from_attributes = True
