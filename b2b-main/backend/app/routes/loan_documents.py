from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from psycopg.types.json import Jsonb

from app.database import get_connection, get_transaction
from app.auth import get_current_admin

router = APIRouter(prefix="/loan-config", tags=["Loan Config"])

class LoanDocConfigUpsert(BaseModel):
    id: Optional[UUID] = None
    loan_type_id: UUID
    document_category: str
    document_name: str
    description: Optional[str] = None
    is_mandatory: bool = False
    conditional_rule: Optional[dict] = None
    applicant_type: list[str] = []
    verification_method: str = "manual_upload"
    requires_esign: bool = False
    allowed_file_types: list[str] = ["pdf", "jpeg", "png"]
    max_file_size_mb: int = 5
    status: bool = True
    display_order: int = 0

@router.get("/types")
def get_loan_types() -> list[dict[str, Any]]:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT d.doc_id, d.doc_name 
            FROM document d
            JOIN category c ON d.category_id = c.category_id
            WHERE c.category_name = 'Loan Documents' AND d.status = true
            ORDER BY d.doc_name
            """
        ).fetchall()

@router.get("/{loan_type_id}")
def get_loan_document_configs(loan_type_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM loan_document_config
            WHERE loan_type_id = %s
            ORDER BY display_order ASC
            """,
            (loan_type_id,)
        ).fetchall()
        return rows

@router.post("")
def upsert_loan_document_config(
    payload: LoanDocConfigUpsert,
    current_admin: dict[str, Any] = Depends(get_current_admin)
) -> dict[str, Any]:
    with get_transaction() as conn:
        data = payload.model_dump()
        data["conditional_rule"] = Jsonb(data["conditional_rule"]) if data.get("conditional_rule") is not None else None
        
        if payload.id:
            row = conn.execute(
                """
                UPDATE loan_document_config SET
                    document_category = %(document_category)s,
                    document_name = %(document_name)s,
                    description = %(description)s,
                    is_mandatory = %(is_mandatory)s,
                    conditional_rule = %(conditional_rule)s,
                    applicant_type = %(applicant_type)s,
                    verification_method = %(verification_method)s,
                    requires_esign = %(requires_esign)s,
                    allowed_file_types = %(allowed_file_types)s,
                    max_file_size_mb = %(max_file_size_mb)s,
                    status = %(status)s,
                    display_order = %(display_order)s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %(id)s
                RETURNING *
                """,
                data
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Config not found")
            return row
        else:
            row = conn.execute(
                """
                INSERT INTO loan_document_config (
                    loan_type_id, document_category, document_name, description, is_mandatory,
                    conditional_rule, applicant_type, verification_method, requires_esign,
                    allowed_file_types, max_file_size_mb, status, display_order
                ) VALUES (
                    %(loan_type_id)s, %(document_category)s, %(document_name)s, %(description)s, %(is_mandatory)s,
                    %(conditional_rule)s, %(applicant_type)s, %(verification_method)s, %(requires_esign)s,
                    %(allowed_file_types)s, %(max_file_size_mb)s, %(status)s, %(display_order)s
                ) RETURNING *
                """,
                data
            ).fetchone()
            return row

@router.delete("/{config_id}")
def delete_loan_document_config(
    config_id: UUID,
    current_admin: dict[str, Any] = Depends(get_current_admin)
) -> dict[str, Any]:
    with get_transaction() as conn:
        row = conn.execute("DELETE FROM loan_document_config WHERE id = %s RETURNING id", (config_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Config not found")
        return {"success": True, "id": row["id"]}
