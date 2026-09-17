from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_admin
from app.database import get_connection

router = APIRouter()


class RoleCreate(BaseModel):
    role_name: str
    status: bool = True


class RoleUpdate(BaseModel):
    role_name: str | None = None
    status: bool | None = None


@router.get("")
def list_roles() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            "SELECT role_id, role_name, status, created_at, modified_at FROM role ORDER BY role_name ASC"
        ).fetchall()


@router.post("", status_code=201)
def create_role(payload: RoleCreate, current_admin: dict[str, Any] = Depends(get_current_admin)) -> dict[str, Any]:
    with get_connection() as connection:
        existing = connection.execute(
            "SELECT role_id FROM role WHERE lower(role_name) = lower(%s)", (payload.role_name,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Role '{payload.role_name}' already exists")

        return connection.execute(
            """
            INSERT INTO role (role_name, status, created_by)
            VALUES (%(role_name)s, %(status)s, %(created_by)s)
            RETURNING role_id, role_name, status, created_at, modified_at
            """,
            {**payload.model_dump(), "created_by": current_admin["id"]},
        ).fetchone()


@router.patch("/{role_id}")
def update_role(
    role_id: UUID, payload: RoleUpdate, current_admin: dict[str, Any] = Depends(get_current_admin)
) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    with get_connection() as connection:
        if "role_name" in data:
            existing = connection.execute(
                "SELECT role_id FROM role WHERE lower(role_name) = lower(%s) AND role_id != %s",
                (data["role_name"], role_id),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail=f"Role '{data['role_name']}' already exists")

        assignments = [f"{field} = %({field})s" for field in data]
        data["role_id"] = role_id
        data["modified_by"] = current_admin["id"]
        sql = f"""
            UPDATE role
            SET {", ".join(assignments)}, modified_by = %(modified_by)s, modified_at = now()
            WHERE role_id = %(role_id)s
            RETURNING role_id, role_name, status, created_at, modified_at
        """
        row = connection.execute(sql, data).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    return row


@router.delete("/{role_id}")
def delete_role(role_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        deleted = connection.execute("DELETE FROM role WHERE role_id = %s RETURNING role_id", (role_id,)).fetchone()
    if not deleted:
        raise HTTPException(status_code=404, detail="Role not found")
    return {"message": "Role deleted successfully"}


def get_active_role_names() -> list[str]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT role_name FROM role WHERE status = true ORDER BY role_name ASC"
        ).fetchall()
    return [row["role_name"] for row in rows]
