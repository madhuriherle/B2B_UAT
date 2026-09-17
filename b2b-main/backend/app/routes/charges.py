from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_connection

router = APIRouter()


class ChargeCreate(BaseModel):
    charge_name: str
    description: str | None = None
    status: bool = True


class ChargeUpdate(BaseModel):
    charge_name: str | None = None
    description: str | None = None
    status: bool | None = None


@router.get("")
def list_charges() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            "SELECT id, charge_name, description, status, created_at, updated_at FROM charge ORDER BY charge_name ASC"
        ).fetchall()


@router.post("", status_code=201)
def create_charge(payload: ChargeCreate) -> dict[str, Any]:
    with get_connection() as connection:
        existing = connection.execute(
            "SELECT id FROM charge WHERE lower(charge_name) = lower(%s)", (payload.charge_name,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Charge '{payload.charge_name}' already exists")

        return connection.execute(
            """
            INSERT INTO charge (charge_name, description, status)
            VALUES (%(charge_name)s, %(description)s, %(status)s)
            RETURNING id, charge_name, description, status, created_at, updated_at
            """,
            payload.model_dump(),
        ).fetchone()


@router.patch("/{charge_id}")
def update_charge(charge_id: UUID, payload: ChargeUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    with get_connection() as connection:
        if "charge_name" in data:
            existing = connection.execute(
                "SELECT id FROM charge WHERE lower(charge_name) = lower(%s) AND id != %s",
                (data["charge_name"], charge_id),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail=f"Charge '{data['charge_name']}' already exists")

        assignments = [f"{field} = %({field})s" for field in data]
        data["charge_id"] = charge_id
        sql = f"""
            UPDATE charge
            SET {", ".join(assignments)}, updated_at = now()
            WHERE id = %(charge_id)s
            RETURNING id, charge_name, description, status, created_at, updated_at
        """
        row = connection.execute(sql, data).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Charge not found")
    return row


@router.delete("/{charge_id}")
def delete_charge(charge_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        deleted = connection.execute("DELETE FROM charge WHERE id = %s RETURNING id", (charge_id,)).fetchone()
    if not deleted:
        raise HTTPException(status_code=404, detail="Charge not found")
    return {"message": "Charge deleted successfully"}


def get_active_charge_names() -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT charge_name FROM charge WHERE status = true ORDER BY charge_name ASC"
        ).fetchall()
    return [row["charge_name"] for row in rows]
