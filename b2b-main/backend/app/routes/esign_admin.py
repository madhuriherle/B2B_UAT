from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from app.auth import get_current_admin
from app.esign_service import admin_get_esign_overview, admin_mark_signer_signed

router = APIRouter()


class MarkSignedRequest(BaseModel):
    note: str

    @field_validator("note")
    @classmethod
    def _require_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A note explaining how signing was confirmed is required")
        return value


@router.get("/orders/{order_id}")
def get_esign_overview(order_id: UUID) -> dict[str, Any]:
    return admin_get_esign_overview(order_id)


@router.post("/orders/{order_id}/signers/{signer_id}/mark-signed")
def mark_signer_signed(
    order_id: UUID,
    signer_id: UUID,
    payload: MarkSignedRequest,
    current_admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    return admin_mark_signer_signed(
        order_id=order_id, signer_id=signer_id, admin_id=current_admin["id"], note=payload.note,
    )
