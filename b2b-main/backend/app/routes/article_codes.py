from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_connection

router = APIRouter()


class ArticleCodeCreate(BaseModel):
    state_id: UUID
    article_code: str
    description: str | None = None
    is_active: bool = True


class ArticleCodeUpdate(BaseModel):
    state_id: UUID | None = None
    article_code: str | None = None
    description: str | None = None
    is_active: bool | None = None


def _check_state_exists(connection, state_id: UUID) -> None:
    if not connection.execute("SELECT id FROM state WHERE id = %s", (state_id,)).fetchone():
        raise HTTPException(status_code=400, detail="Selected state was not found")


def _check_code_unique_in_state(
    connection, *, state_id: UUID, article_code: str, exclude_id: UUID | None = None
) -> None:
    # Uniqueness is per-state now (see schema.sql's b2b_article_code_state_code_unique
    # index) — the same code is allowed under two different states, only ever
    # blocked when it repeats under the SAME one.
    existing = connection.execute(
        "SELECT id FROM b2b_article_code WHERE state_id = %s AND lower(article_code) = lower(%s) "
        "AND (%s::uuid IS NULL OR id != %s)",
        (state_id, article_code, exclude_id, exclude_id),
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="Article code already exists for this state.")


@router.get("")
def list_article_codes(state_id: UUID | None = None) -> list[dict[str, Any]]:
    with get_connection() as connection:
        if state_id is not None:
            return connection.execute(
                """
                SELECT ac.id, ac.state_id, s.state_name, ac.article_code, ac.description,
                       ac.is_active, ac.created_at, ac.updated_at
                FROM b2b_article_code ac
                LEFT JOIN state s ON s.id = ac.state_id
                WHERE ac.state_id = %s
                ORDER BY ac.article_code ASC
                """,
                (state_id,),
            ).fetchall()
        return connection.execute(
            """
            SELECT ac.id, ac.state_id, s.state_name, ac.article_code, ac.description,
                   ac.is_active, ac.created_at, ac.updated_at
            FROM b2b_article_code ac
            LEFT JOIN state s ON s.id = ac.state_id
            ORDER BY s.state_name ASC NULLS FIRST, ac.article_code ASC
            """
        ).fetchall()


@router.post("", status_code=201)
def create_article_code(payload: ArticleCodeCreate) -> dict[str, Any]:
    with get_connection() as connection:
        _check_state_exists(connection, payload.state_id)
        _check_code_unique_in_state(connection, state_id=payload.state_id, article_code=payload.article_code)

        return connection.execute(
            """
            INSERT INTO b2b_article_code (state_id, article_code, description, is_active)
            VALUES (%(state_id)s, %(article_code)s, %(description)s, %(is_active)s)
            RETURNING id, state_id, article_code, description, is_active, created_at, updated_at
            """,
            payload.model_dump(),
        ).fetchone()


@router.patch("/{article_code_id}")
def update_article_code(article_code_id: UUID, payload: ArticleCodeUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    with get_connection() as connection:
        current = connection.execute(
            "SELECT state_id, article_code FROM b2b_article_code WHERE id = %s", (article_code_id,)
        ).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Article Code not found")

        if "state_id" in data:
            _check_state_exists(connection, data["state_id"])

        # Re-check uniqueness whenever either half of the (state, code) pair
        # is changing, against whichever value — new or unchanged — the other
        # half will end up being.
        if "state_id" in data or "article_code" in data:
            effective_state_id = data.get("state_id", current["state_id"])
            effective_code = data.get("article_code", current["article_code"])
            if effective_state_id is not None:
                _check_code_unique_in_state(
                    connection, state_id=effective_state_id, article_code=effective_code, exclude_id=article_code_id
                )

        assignments = [f"{field} = %({field})s" for field in data]
        data["article_code_id"] = article_code_id
        sql = f"""
            UPDATE b2b_article_code
            SET {", ".join(assignments)}, updated_at = now()
            WHERE id = %(article_code_id)s
            RETURNING id, state_id, article_code, description, is_active, created_at, updated_at
        """
        row = connection.execute(sql, data).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Article Code not found")
    return row


@router.delete("/{article_code_id}")
def delete_article_code(article_code_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        deleted = connection.execute(
            "DELETE FROM b2b_article_code WHERE id = %s RETURNING id", (article_code_id,)
        ).fetchone()
    if not deleted:
        raise HTTPException(status_code=404, detail="Article Code not found")
    return {"message": "Article Code deleted successfully"}


def get_active_article_codes(state_id: UUID | None = None) -> list[dict[str, Any]]:
    with get_connection() as connection:
        if state_id is not None:
            return connection.execute(
                "SELECT id, article_code, description FROM b2b_article_code "
                "WHERE is_active = true AND state_id = %s ORDER BY article_code ASC",
                (state_id,),
            ).fetchall()
        return connection.execute(
            "SELECT id, article_code, description FROM b2b_article_code WHERE is_active = true ORDER BY article_code ASC"
        ).fetchall()
