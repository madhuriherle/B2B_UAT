from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.doc_state_config import DocStateConfig
from app.b2c_admin.models.state import State

router = APIRouter(prefix="/api/admin/doc-state-config", tags=["admin-doc-state-config"])


class StateConfigItem(BaseModel):
    state_id: UUID
    english_enabled: Optional[bool] = True
    actual_price: Optional[Decimal] = None
    offer_price: Optional[Decimal] = None
    stamp_denominations: Optional[List[float]] = None
    notary_price: Optional[Decimal] = None
    esign_price: Optional[Decimal] = None


class DocStateConfigCreate(BaseModel):
    doc_id: UUID
    state_configurations: List[StateConfigItem]


class StateConfigResponse(BaseModel):
    id: UUID
    doc_id: UUID
    state_id: UUID
    state_name: Optional[str] = None
    english_enabled: Optional[bool] = True
    actual_price: Optional[Decimal] = None
    offer_price: Optional[Decimal] = None
    stamp_denominations: Optional[List[float]] = None
    notary_price: Optional[Decimal] = None
    esign_price: Optional[Decimal] = None
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/{doc_id}", response_model=List[StateConfigResponse])
def get_doc_state_configs(doc_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    configs = db.query(DocStateConfig).filter(DocStateConfig.doc_id == doc_id).all()
    result = []
    for c in configs:
        state = db.query(State).filter(State.id == c.state_id).first()
        result.append(StateConfigResponse(
            id=c.id, doc_id=c.doc_id,
            state_id=c.state_id,
            state_name=state.state_name if state else "",
            english_enabled=c.english_enabled if c.english_enabled is not None else True,
            actual_price=c.actual_price,
            offer_price=c.offer_price,
            stamp_denominations=c.stamp_denominations or [],
            notary_price=c.notary_price,
            esign_price=c.esign_price,
            is_active=c.is_active if c.is_active is not None else True,
        ))
    return result


@router.post("")
def save_doc_state_configs(data: DocStateConfigCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    seen = set()
    for item in data.state_configurations:
        key = str(item.state_id)
        if key in seen:
            raise HTTPException(status_code=400, detail="Duplicate state in request.")
        seen.add(key)

    db.query(DocStateConfig).filter(DocStateConfig.doc_id == data.doc_id).delete()
    db.flush()

    try:
        for item in data.state_configurations:
            config = DocStateConfig(
                doc_id=data.doc_id,
                state_id=item.state_id,
                english_enabled=item.english_enabled if item.english_enabled is not None else True,
                actual_price=item.actual_price,
                offer_price=item.offer_price,
                stamp_denominations=item.stamp_denominations or [],
                notary_price=item.notary_price,
                esign_price=item.esign_price,
                is_active=True,
                created_by=current_user["id"],
            )
            db.add(config)

        db.commit()
        return {"message": "Saved", "count": len(data.state_configurations)}

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This state combination is already added.")


@router.delete("/{config_id}")
def delete_config(config_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    config = db.query(DocStateConfig).filter(DocStateConfig.id == config_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    db.delete(config)
    db.commit()
    return {"message": "Deleted"}
