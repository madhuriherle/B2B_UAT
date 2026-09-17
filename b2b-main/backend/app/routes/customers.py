from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_connection

router = APIRouter()


class CustomerCreate(BaseModel):
    company_name: str
    address: str
    city: str
    state: str
    postal_code: str
    gstin: str | None = None


class CustomerUpdate(BaseModel):
    company_name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    gstin: str | None = None


@router.get("")
def list_customers() -> list[dict[str, Any]]:
    sql = "SELECT * FROM b2b_customers ORDER BY created_at DESC"
    with get_connection() as connection:
        return connection.execute(sql).fetchall()


@router.post("", status_code=201)
def create_customer(payload: CustomerCreate) -> dict[str, Any]:
    sql = """
        INSERT INTO b2b_customers (company_name, address, city, state, postal_code, gstin)
        VALUES (%(company_name)s, %(address)s, %(city)s, %(state)s, %(postal_code)s, %(gstin)s)
        RETURNING *
    """
    with get_connection() as connection:
        return connection.execute(sql, payload.model_dump()).fetchone()


@router.get("/{customer_id}")
def get_customer(customer_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        customer = connection.execute("SELECT * FROM b2b_customers WHERE id = %s", (customer_id,)).fetchone()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.patch("/{customer_id}")
def update_customer(customer_id: UUID, payload: CustomerUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    with get_connection() as connection:
        current = connection.execute("SELECT id FROM b2b_customers WHERE id = %s", (customer_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Customer not found")

        set_clause = ", ".join(f"{field} = %({field})s" for field in data)
        data["customer_id"] = customer_id
        sql = f"""
            UPDATE b2b_customers
            SET {set_clause}, updated_at = now()
            WHERE id = %(customer_id)s
            RETURNING *
        """
        return connection.execute(sql, data).fetchone()


@router.delete("/{customer_id}")
def delete_customer(customer_id: UUID) -> dict[str, str]:
    with get_connection() as connection:
        in_use = connection.execute(
            "SELECT 1 FROM b2b_invoices WHERE customer_id = %s LIMIT 1", (customer_id,)
        ).fetchone()
        if in_use:
            raise HTTPException(status_code=400, detail="Cannot delete a customer that has invoices")

        result = connection.execute(
            "DELETE FROM b2b_customers WHERE id = %s RETURNING id", (customer_id,)
        ).fetchone()

    if not result:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"status": "deleted"}
