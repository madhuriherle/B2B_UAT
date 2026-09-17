"""
Admin Print & Delivery Stamp Denominations API
------------------------------------------------
GET    /api/admin/print-delivery-stamp-denom                  -> list mappings (filter by service_id/state_id)
POST   /api/admin/print-delivery-stamp-denom                  -> create a mapping
GET    /api/admin/print-delivery-stamp-denom/{id}              -> single mapping
PUT    /api/admin/print-delivery-stamp-denom/{id}              -> update status
DELETE /api/admin/print-delivery-stamp-denom/{id}              -> delete mapping
POST   /api/admin/print-delivery-stamp-denom/state/{state_id}/configure -> replace all mappings for a state's service
"""

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.print_delivery_service_model import PrintDeliveryService
from app.b2c_admin.models.print_delivery_stamp_denom import PrintDeliveryStampDenom
from app.b2c_admin.models.stamp_denom import StampDenom
from app.b2c_admin.models.state import State
from app.b2c_admin.schemas.print_delivery_stamp_denom_schema import (
    PrintDeliveryStampDenomCreate,
    PrintDeliveryStampDenomResponse,
    PrintDeliveryStampDenomUpdate,
)

router = APIRouter(prefix="/api/admin/print-delivery-stamp-denom", tags=["print-delivery"])


@router.get("", response_model=List[PrintDeliveryStampDenomResponse])
def get_all_print_delivery_denoms(
    service_id: Optional[int] = None,
    state_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    query = db.query(PrintDeliveryStampDenom)
    if service_id:
        query = query.filter(PrintDeliveryStampDenom.print_delivery_service_id == service_id)
    if state_id:
        service = db.query(PrintDeliveryService).filter(PrintDeliveryService.state_id == state_id).first()
        if service:
            query = query.filter(PrintDeliveryStampDenom.print_delivery_service_id == service.id)
    return query.order_by(PrintDeliveryStampDenom.print_delivery_service_id).all()


@router.post("", response_model=PrintDeliveryStampDenomResponse)
def create_print_delivery_denom(data: PrintDeliveryStampDenomCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    if not db.query(PrintDeliveryService).filter(PrintDeliveryService.id == data.print_delivery_service_id).first():
        raise HTTPException(status_code=404, detail="Print delivery service not found")
    if not db.query(StampDenom).filter(StampDenom.id == data.stamp_denom_id).first():
        raise HTTPException(status_code=404, detail="Stamp denomination not found")
    if db.query(PrintDeliveryStampDenom).filter(
        PrintDeliveryStampDenom.print_delivery_service_id == data.print_delivery_service_id,
        PrintDeliveryStampDenom.stamp_denom_id == data.stamp_denom_id,
    ).first():
        raise HTTPException(status_code=400, detail="This denomination is already configured for this service")

    mapping = PrintDeliveryStampDenom(
        print_delivery_service_id=data.print_delivery_service_id,
        stamp_denom_id=data.stamp_denom_id,
        status=data.status,
        created_by=current_user["id"],
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return mapping


@router.get("/{mapping_id}", response_model=PrintDeliveryStampDenomResponse)
def get_print_delivery_denom(mapping_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    mapping = db.query(PrintDeliveryStampDenom).filter(PrintDeliveryStampDenom.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    return mapping


@router.put("/{mapping_id}", response_model=PrintDeliveryStampDenomResponse)
def update_print_delivery_denom(mapping_id: int, data: PrintDeliveryStampDenomUpdate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    mapping = db.query(PrintDeliveryStampDenom).filter(PrintDeliveryStampDenom.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    if data.status is not None:
        mapping.status = data.status
    mapping.modified_by = current_user["id"]
    mapping.modified_at = datetime.utcnow()

    db.commit()
    db.refresh(mapping)
    return mapping


@router.delete("/{mapping_id}")
def delete_print_delivery_denom(mapping_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    mapping = db.query(PrintDeliveryStampDenom).filter(PrintDeliveryStampDenom.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(mapping)
    db.commit()
    return {"message": "Mapping deleted successfully"}


@router.post("/state/{state_id}/configure")
def configure_denominations_for_state(state_id: UUID, denomination_ids: List[UUID], db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    state = db.query(State).filter(State.id == state_id).first()
    if not state:
        raise HTTPException(status_code=404, detail="State not found")

    service = db.query(PrintDeliveryService).filter(PrintDeliveryService.state_id == state_id).first()
    if not service:
        raise HTTPException(status_code=400, detail="Print delivery service must be created for this state first")

    for denom_id in denomination_ids:
        if not db.query(StampDenom).filter(StampDenom.id == denom_id).first():
            raise HTTPException(status_code=404, detail=f"Denomination {denom_id} not found")

    db.query(PrintDeliveryStampDenom).filter(PrintDeliveryStampDenom.print_delivery_service_id == service.id).delete()
    for denom_id in denomination_ids:
        db.add(PrintDeliveryStampDenom(print_delivery_service_id=service.id, stamp_denom_id=denom_id, status=True, created_by=current_user["id"]))

    db.commit()
    return {
        "message": f"Configured {len(denomination_ids)} denominations for {state.state_name}",
        "state_id": str(state_id),
        "state_name": state.state_name,
        "service_id": service.id,
        "denomination_count": len(denomination_ids),
    }
