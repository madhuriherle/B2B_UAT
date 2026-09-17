from typing import Any
from uuid import UUID

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel

from app.routes.partner import (
    cancel_manual_estamp_order,
    get_manual_estamp_order_admin,
    send_manual_estamp_for_esign,
    update_manual_estamp_order_status,
    upload_manual_estamp_stamped_document,
)

router = APIRouter()


class ManualEstampStatusUpdate(BaseModel):
    status: str


@router.get("/orders/{order_id}")
def get_manual_estamp_order(order_id: UUID) -> dict[str, Any]:
    return get_manual_estamp_order_admin(order_id)


@router.patch("/orders/{order_id}/status")
def patch_manual_estamp_order_status(order_id: UUID, payload: ManualEstampStatusUpdate) -> dict[str, Any]:
    return update_manual_estamp_order_status(order_id, payload.status)


@router.post("/orders/{order_id}/stamped-document")
async def post_manual_estamp_stamped_document(order_id: UUID, file: UploadFile = File(...)) -> dict[str, Any]:
    return upload_manual_estamp_stamped_document(order_id, file)


@router.post("/orders/{order_id}/send-for-esign")
def post_manual_estamp_send_for_esign(order_id: UUID) -> dict[str, Any]:
    return send_manual_estamp_for_esign(order_id)


@router.post("/orders/{order_id}/cancel")
def post_cancel_manual_estamp_order(order_id: UUID) -> dict[str, Any]:
    return cancel_manual_estamp_order(order_id)
