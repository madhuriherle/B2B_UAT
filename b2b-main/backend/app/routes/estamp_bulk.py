from typing import Any
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.routes.partner import (
    add_bulk_estamp_denomination,
    cancel_bulk_estamp_order,
    get_bulk_estamp_order_admin,
    update_bulk_estamp_order_status,
)

router = APIRouter()


class BulkEstampStatusUpdate(BaseModel):
    status: str
    # Only meaningful (and required server-side) when status == "Completed" —
    # see update_bulk_estamp_order_status.
    stamp_number: str | None = None


class BulkEstampDenominationLineIn(BaseModel):
    denomination: float
    quantity: int = 1


class BulkEstampDenominationUpdate(BaseModel):
    # A single eStamp order can need more than one stamp paper behind one
    # Consideration Amount (mirrors Traditional Stamp Paper's multi-row
    # order) — each line is priced independently (see
    # partner.add_bulk_estamp_denomination).
    items: list[BulkEstampDenominationLineIn]


@router.get("/orders/{order_id}")
def get_bulk_estamp_order(order_id: UUID) -> dict[str, Any]:
    return get_bulk_estamp_order_admin(order_id)


@router.patch("/orders/{order_id}/status")
def patch_bulk_estamp_order_status(order_id: UUID, payload: BulkEstampStatusUpdate) -> dict[str, Any]:
    return update_bulk_estamp_order_status(order_id, payload.status, payload.stamp_number)


@router.post("/orders/{order_id}/denomination")
def post_bulk_estamp_denomination(order_id: UUID, payload: BulkEstampDenominationUpdate) -> dict[str, Any]:
    return add_bulk_estamp_denomination(order_id, [item.model_dump() for item in payload.items])


@router.post("/orders/{order_id}/cancel")
def post_cancel_bulk_estamp_order(order_id: UUID) -> dict[str, Any]:
    return cancel_bulk_estamp_order(order_id)
