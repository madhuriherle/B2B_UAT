from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_connection

router = APIRouter()


class ServiceCreate(BaseModel):
    service_name: str
    description: str | None = None
    status: bool = True


class ServiceUpdate(BaseModel):
    service_name: str | None = None
    description: str | None = None
    status: bool | None = None


@router.get("")
def list_services() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            "SELECT id, service_name, description, status, created_at, updated_at FROM service ORDER BY service_name ASC"
        ).fetchall()


@router.post("", status_code=201)
def create_service(payload: ServiceCreate) -> dict[str, Any]:
    with get_connection() as connection:
        existing = connection.execute(
            "SELECT id FROM service WHERE lower(service_name) = lower(%s)", (payload.service_name,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Service '{payload.service_name}' already exists")

        return connection.execute(
            """
            INSERT INTO service (service_name, description, status)
            VALUES (%(service_name)s, %(description)s, %(status)s)
            RETURNING id, service_name, description, status, created_at, updated_at
            """,
            payload.model_dump(),
        ).fetchone()


@router.patch("/{service_id}")
def update_service(service_id: UUID, payload: ServiceUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    with get_connection() as connection:
        if "service_name" in data:
            existing = connection.execute(
                "SELECT id FROM service WHERE lower(service_name) = lower(%s) AND id != %s",
                (data["service_name"], service_id),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail=f"Service '{data['service_name']}' already exists")

        assignments = [f"{field} = %({field})s" for field in data]
        data["service_id"] = service_id
        sql = f"""
            UPDATE service
            SET {", ".join(assignments)}, updated_at = now()
            WHERE id = %(service_id)s
            RETURNING id, service_name, description, status, created_at, updated_at
        """
        row = connection.execute(sql, data).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Service not found")
    return row


@router.delete("/{service_id}")
def delete_service(service_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        deleted = connection.execute("DELETE FROM service WHERE id = %s RETURNING id", (service_id,)).fetchone()
    if not deleted:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": "Service deleted successfully"}


def get_active_service_names() -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT service_name FROM service WHERE status = true ORDER BY service_name ASC"
        ).fetchall()
    return [row["service_name"] for row in rows]
