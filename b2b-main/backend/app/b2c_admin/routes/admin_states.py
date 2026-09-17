"""
Admin States API
----------------
GET    /api/admin/states        -> list all states
GET    /api/admin/states/{id}   -> single state
POST   /api/admin/states        -> create
PUT    /api/admin/states/{id}   -> update
DELETE /api/admin/states/{id}   -> delete (cascade-safe)

Covers the "States" tab.
"""

from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.doc_state_config import DocStateConfig
from app.b2c_admin.models.state import State
from app.b2c_admin.models.user_doc import UserDoc
from app.b2c_admin.schemas.state import StateCreate, StateResponse, StateUpdate

router = APIRouter(prefix="/api/admin/states", tags=["admin-states"])


@router.get("", response_model=List[StateResponse])
def list_states(
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    return db.query(State).order_by(State.state_name).all()


@router.get("/{state_id}", response_model=StateResponse)
def get_state(
    state_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    state = db.query(State).filter(State.id == state_id).first()
    if not state:
        raise HTTPException(status_code=404, detail="State not found")
    return state


@router.post("", response_model=StateResponse, status_code=201)
def create_state(
    data: StateCreate,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    if db.query(State).filter(State.state_name.ilike(data.state_name)).first():
        raise HTTPException(status_code=400, detail="State already exists")

    s = State(
        state_name=data.state_name,
        language_name=data.language_name,
        is_active=data.is_active,
        created_by=current_user["id"],
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.put("/{state_id}", response_model=StateResponse)
def update_state(
    state_id: UUID,
    data: StateUpdate,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    state = db.query(State).filter(State.id == state_id).first()
    if not state:
        raise HTTPException(status_code=404, detail="State not found")

    if data.state_name is not None:
        duplicate = db.query(State).filter(
            State.state_name.ilike(data.state_name),
            State.id != state_id,
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Another state with that name exists")
        state.state_name = data.state_name

    if data.language_name is not None:
        state.language_name = data.language_name
    if data.is_active is not None:
        state.is_active = data.is_active

    state.modified_by = current_user["id"]
    db.commit()
    db.refresh(state)
    return state


@router.delete("/{state_id}")
def delete_state(
    state_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    state = db.query(State).filter(State.id == state_id).first()
    if not state:
        raise HTTPException(status_code=404, detail="State not found")

    # Cascade: remove doc-state configs, nullify state on user docs
    db.query(DocStateConfig).filter(DocStateConfig.state_id == state_id).delete()
    db.query(UserDoc).filter(UserDoc.state_id == state_id).update({"state_id": None})

    db.delete(state)
    db.commit()
    return {"message": "State deleted"}
