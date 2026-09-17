from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_admin
from app.database import get_connection, get_transaction

router = APIRouter()


class StampCreate(BaseModel):
    state_id: UUID
    stamp_value: float
    description: str | None = None
    is_active: bool = True


class StampUpdate(BaseModel):
    state_id: UUID | None = None
    stamp_value: float | None = None
    description: str | None = None
    is_active: bool | None = None


@router.get("")
def list_stamps() -> list[dict[str, Any]]:
    sql = """
        SELECT
            b.id,
            b.state_id,
            s.state_name,
            b.stamp_value,
            b.description,
            b.is_active,
            b.created_at,
            b.updated_at
        FROM b2b_stamp_denomination b
        JOIN state s ON s.id = b.state_id
        ORDER BY b.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql).fetchall()


@router.post("", status_code=201)
def create_stamp(payload: StampCreate, current_admin: dict[str, Any] = Depends(get_current_admin)) -> dict[str, Any]:
    sql = """
        INSERT INTO b2b_stamp_denomination (
            state_id,
            stamp_value,
            description,
            is_active
        )
        VALUES (
            %(state_id)s,
            %(stamp_value)s,
            %(description)s,
            %(is_active)s
        )
        RETURNING id, state_id, stamp_value, description, is_active, created_at, updated_at
    """
    with get_transaction() as connection:
        row = connection.execute(sql, payload.model_dump()).fetchone()
        state = connection.execute(
            "SELECT state_name FROM state WHERE id = %s", (row["state_id"],)
        ).fetchone()
        connection.execute(
            """
            INSERT INTO stamp_denomination_price_history (stamp_denomination_id, stamp_value, changed_by)
            VALUES (%s, %s, %s)
            """,
            (row["id"], row["stamp_value"], current_admin["id"]),
        )

    row["state_name"] = state["state_name"] if state else None
    return row


@router.patch("/{stamp_id}")
def update_stamp(
    stamp_id: UUID,
    payload: StampUpdate,
    current_admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    assignments = [f"{field} = %({field})s" for field in data]
    data["stamp_id"] = stamp_id
    sql = f"""
        UPDATE b2b_stamp_denomination
        SET {", ".join(assignments)}, updated_at = now()
        WHERE id = %(stamp_id)s
        RETURNING id, state_id, stamp_value, description, is_active, created_at, updated_at
    """
    with get_transaction() as connection:
        previous = None
        if "stamp_value" in data:
            previous = connection.execute(
                "SELECT stamp_value FROM b2b_stamp_denomination WHERE id = %s", (stamp_id,)
            ).fetchone()

        row = connection.execute(sql, data).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Stamp denomination not found")

        if "stamp_value" in data and (
            previous is None or float(previous["stamp_value"]) != float(row["stamp_value"])
        ):
            connection.execute(
                """
                INSERT INTO stamp_denomination_price_history (stamp_denomination_id, stamp_value, changed_by)
                VALUES (%s, %s, %s)
                """,
                (row["id"], row["stamp_value"], current_admin["id"]),
            )

        state = connection.execute(
            "SELECT state_name FROM state WHERE id = %s", (row["state_id"],)
        ).fetchone()

    row["state_name"] = state["state_name"] if state else None
    return row


@router.delete("/{stamp_id}")
def delete_stamp(stamp_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        deleted = connection.execute(
            """
            DELETE FROM b2b_stamp_denomination
            WHERE id = %s
            RETURNING id
            """,
            (stamp_id,),
        ).fetchone()

    if not deleted:
        raise HTTPException(status_code=404, detail="Stamp denomination not found")

    return {"message": "Stamp denomination deleted successfully"}


@router.get("/{stamp_id}/history")
def get_stamp_price_history(stamp_id: UUID, limit: int = 20, offset: int = 0) -> dict[str, Any]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    with get_connection() as connection:
        total = connection.execute(
            "SELECT COUNT(*) AS n FROM stamp_denomination_price_history WHERE stamp_denomination_id = %s",
            (stamp_id,),
        ).fetchone()["n"]
        items = connection.execute(
            """
            SELECT h.id, h.stamp_value, h.effective_from, h.created_at, u.full_name AS changed_by_name
            FROM stamp_denomination_price_history h
            LEFT JOIN users u ON u.id = h.changed_by
            WHERE h.stamp_denomination_id = %s
            ORDER BY h.effective_from DESC
            LIMIT %s OFFSET %s
            """,
            (stamp_id, limit, offset),
        ).fetchall()
    return {"total": total, "items": items}
