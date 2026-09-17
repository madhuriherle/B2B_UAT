"""
Admin Print & Delivery Service API
----------------------------------
GET    /api/admin/print-delivery-service         -> list all services (+ denominations)
GET    /api/admin/print-delivery-service/{id}    -> single service
POST   /api/admin/print-delivery-service         -> create (per state)
PUT    /api/admin/print-delivery-service/{id}    -> update
DELETE /api/admin/print-delivery-service/{id}    -> delete

Covers the "Print & Delivery" tab.
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.print_delivery_service_model import PrintDeliveryService
from app.b2c_admin.models.print_delivery_stamp_denom import PrintDeliveryStampDenom
from app.b2c_admin.models.stamp_denom import StampDenom
from app.b2c_admin.models.state import State

router = APIRouter(prefix="/api/admin/print-delivery-service", tags=["print-delivery"])


class StampDenomOption(BaseModel):
    id: UUID
    denomvalue: float
    display: str


class PrintDeliveryServiceCreate(BaseModel):
    state_id: UUID
    document_type: Optional[str] = None
    service_charge: Decimal = Decimal("0")
    per_copy_price: Optional[Decimal] = None
    stamp_denomination_ids: Optional[List[UUID]] = None
    esign_price: Optional[Decimal] = None
    enotary_price: Optional[Decimal] = None
    status: bool = True


class PrintDeliveryServiceUpdate(BaseModel):
    document_type: Optional[str] = None
    service_charge: Optional[Decimal] = None
    per_copy_price: Optional[Decimal] = None
    stamp_denomination_ids: Optional[List[UUID]] = None
    esign_price: Optional[Decimal] = None
    enotary_price: Optional[Decimal] = None
    status: Optional[bool] = None


def _denominations_for(db: Session, service_id: int):
    return (
        db.query(StampDenom)
        .join(PrintDeliveryStampDenom, StampDenom.id == PrintDeliveryStampDenom.stamp_denom_id)
        .filter(PrintDeliveryStampDenom.print_delivery_service_id == service_id, PrintDeliveryStampDenom.status == True)  # noqa: E712
        .order_by(StampDenom.denomvalue)
        .all()
    )


def _service_payload(db: Session, service: PrintDeliveryService) -> dict:
    denominations = _denominations_for(db, service.id)
    return {
        "id": service.id,
        "state_id": service.state_id,
        "state_name": service.state.state_name if service.state else None,
        "document_type": service.document_type,
        "service_charge": float(service.service_charge),
        "per_copy_price": float(service.per_copy_price) if service.per_copy_price is not None else None,
        "esign_price": float(service.esign_price) if service.esign_price is not None else None,
        "enotary_price": float(service.enotary_price) if service.enotary_price is not None else None,
        "stamp_denominations": [{"id": str(d.id), "denomvalue": float(d.denomvalue), "display": f"Rs.{int(d.denomvalue)}"} for d in denominations],
        "status": service.status,
    }


@router.get("")
def list_print_delivery_services(db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    services = db.query(PrintDeliveryService).all()
    return [_service_payload(db, s) for s in services]


@router.get("/catalog/stamp-denominations")
def list_stamp_denomination_catalog(db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    """The full stamp_denom catalog (shared with the B2C app), for populating
    the denomination multi-select when configuring a state's service."""
    denoms = db.query(StampDenom).filter(StampDenom.status == True).order_by(StampDenom.denomvalue).all()  # noqa: E712
    return [{"id": str(d.id), "denomvalue": float(d.denomvalue), "display": f"Rs.{int(d.denomvalue)}"} for d in denoms]


@router.get("/{service_id}")
def get_print_delivery_service(service_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    service = db.query(PrintDeliveryService).filter(PrintDeliveryService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return _service_payload(db, service)


@router.post("")
def create_print_delivery_service(data: PrintDeliveryServiceCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    state = db.query(State).filter(State.id == data.state_id).first()
    if not state:
        raise HTTPException(status_code=404, detail="State not found")

    if db.query(PrintDeliveryService).filter(PrintDeliveryService.state_id == data.state_id).first():
        raise HTTPException(status_code=400, detail="Print & Delivery service already exists for this state")

    denom_ids = data.stamp_denomination_ids or []
    if denom_ids:
        found = db.query(StampDenom).filter(StampDenom.id.in_(denom_ids), StampDenom.status == True).all()  # noqa: E712
        if len(found) != len(denom_ids):
            raise HTTPException(status_code=404, detail="Some denominations not found")

    service = PrintDeliveryService(
        state_id=data.state_id,
        document_type=data.document_type,
        service_charge=data.service_charge,
        per_copy_price=data.per_copy_price,
        esign_price=data.esign_price,
        enotary_price=data.enotary_price,
        status=data.status,
        created_by=current_user["id"],
    )
    db.add(service)
    db.flush()

    for denom_id in denom_ids:
        db.add(PrintDeliveryStampDenom(print_delivery_service_id=service.id, stamp_denom_id=denom_id, status=True, created_by=current_user["id"]))

    db.commit()
    db.refresh(service)
    return _service_payload(db, service)


@router.put("/{service_id}")
def update_print_delivery_service(service_id: int, data: PrintDeliveryServiceUpdate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    service = db.query(PrintDeliveryService).filter(PrintDeliveryService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    if data.document_type is not None:
        service.document_type = data.document_type
    if data.service_charge is not None:
        service.service_charge = data.service_charge
    if data.per_copy_price is not None:
        service.per_copy_price = data.per_copy_price
    if data.esign_price is not None:
        service.esign_price = data.esign_price
    if data.enotary_price is not None:
        service.enotary_price = data.enotary_price
    if data.status is not None:
        service.status = data.status

    if data.stamp_denomination_ids is not None:
        found = db.query(StampDenom).filter(StampDenom.id.in_(data.stamp_denomination_ids), StampDenom.status == True).all()  # noqa: E712
        if len(found) != len(data.stamp_denomination_ids):
            raise HTTPException(status_code=404, detail="Some denominations not found")

        db.query(PrintDeliveryStampDenom).filter(PrintDeliveryStampDenom.print_delivery_service_id == service.id).delete()
        for denom_id in data.stamp_denomination_ids:
            db.add(PrintDeliveryStampDenom(print_delivery_service_id=service.id, stamp_denom_id=denom_id, status=True, created_by=current_user["id"]))

    service.modified_by = current_user["id"]
    service.modified_at = datetime.utcnow()

    db.commit()
    db.refresh(service)
    return _service_payload(db, service)


@router.delete("/{service_id}")
def delete_print_delivery_service(service_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    service = db.query(PrintDeliveryService).filter(PrintDeliveryService.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    db.query(PrintDeliveryStampDenom).filter(PrintDeliveryStampDenom.print_delivery_service_id == service.id).delete()
    db.delete(service)
    db.commit()
    return {"message": "Service deleted successfully"}
