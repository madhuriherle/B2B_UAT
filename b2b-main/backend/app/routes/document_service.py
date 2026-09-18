from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_admin
from app.database import get_connection, get_transaction

router = APIRouter()

DOCUMENT_SERVICE_NAME = "Document Service"


def _document_service_active(connection: Any, organization_id: UUID) -> bool:
    row = connection.execute(
        "SELECT is_active FROM organization_service_pricing WHERE organization_id = %s AND service_name = %s",
        (organization_id, DOCUMENT_SERVICE_NAME),
    ).fetchone()
    return bool(row and row["is_active"])

# =========================================
# ORGANIZATION DOCUMENT CONFIG — per PARTNER + STATE + DOCUMENT
#
# A partner only sees/sells the specific documents an admin has selected for
# them, per state — not the full B2C document catalog. Each selected document
# gets its own base price, language support, and eStamp/eSign/eNotary pricing.
#
# Whether eStamp/eSign/eNotary are AVAILABLE at all for a doc+state is read
# live from the existing shared B2C `doc_state_config` table (already managed
# by the B2C admin panel) — this table only stores B2B's own partner-specific
# price for whichever of those B2C has enabled.
# =========================================

PRICE_TYPE_BY_FIELD = {
    "base_price": "base",
    "estamp_price": "estamp",
    "esign_price": "esign",
    "enotary_price": "enotary",
}


class OrganizationDocumentConfigUpsert(BaseModel):
    organization_id: UUID
    state_id: UUID
    doc_id: UUID
    base_price: float | None = None
    multi_language_enabled: bool = False
    available_languages: list[str] = []
    estamp_price: float | None = None
    esign_price: float | None = None
    enotary_price: float | None = None
    status: bool = True


@router.get("/config")
def list_organization_document_configs(organization_id: UUID, state_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        if not _document_service_active(connection, organization_id):
            raise HTTPException(status_code=400, detail="Document Service is not enabled for this partner")

        rows = connection.execute(
            """
            SELECT
                d.doc_id,
                d.doc_name,
                c.category_name,
                dsc.esign_price AS b2c_esign_price,
                dsc.notary_price AS b2c_notary_price,
                dsc.stamp_denominations,
                odc.id AS config_id,
                odc.base_price,
                odc.multi_language_enabled,
                odc.available_languages,
                odc.estamp_price,
                odc.esign_price,
                odc.enotary_price,
                odc.status,
                odc.updated_at
            FROM document d
            LEFT JOIN category c ON c.category_id = d.category_id
            LEFT JOIN doc_state_config dsc
                ON dsc.doc_id = d.doc_id AND dsc.state_id = %(state_id)s AND dsc.is_active = true
            LEFT JOIN organization_document_config odc
                ON odc.doc_id = d.doc_id AND odc.state_id = %(state_id)s AND odc.organization_id = %(organization_id)s
            WHERE d.status = true
            ORDER BY d.doc_name ASC
            """,
            {"state_id": state_id, "organization_id": organization_id},
        ).fetchall()

    return [
        {
            "doc_id": row["doc_id"],
            "doc_name": row["doc_name"],
            "category_name": row["category_name"],
            "config_id": row["config_id"],
            "selected": bool(row["config_id"] and row["status"]),
            "base_price": row["base_price"],
            "multi_language_enabled": row["multi_language_enabled"] or False,
            "available_languages": row["available_languages"] or [],
            "estamp_available": bool(row["stamp_denominations"]),
            "esign_available": row["b2c_esign_price"] is not None,
            "enotary_available": row["b2c_notary_price"] is not None,
            "estamp_price": row["estamp_price"],
            "esign_price": row["esign_price"],
            "enotary_price": row["enotary_price"],
            "status": bool(row["status"]),
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


@router.get("/config/summary")
def list_configured_documents_summary(organization_id: UUID) -> list[dict[str, Any]]:
    """All active document configs for a partner across every state — used by
    the Partner List 'View Services' modal, which doesn't filter by state.

    Configured documents only ever mean something while Document Service is
    enabled for the partner — if it's off, none should show even if stale
    rows exist from before it was disabled."""
    with get_connection() as connection:
        if not _document_service_active(connection, organization_id):
            return []

        return connection.execute(
            """
            SELECT
                odc.id AS config_id,
                odc.doc_id,
                d.doc_name,
                c.category_name,
                odc.state_id,
                s.state_name,
                odc.base_price,
                odc.available_languages
            FROM organization_document_config odc
            JOIN document d ON d.doc_id = odc.doc_id
            LEFT JOIN category c ON c.category_id = d.category_id
            LEFT JOIN state s ON s.id = odc.state_id
            WHERE odc.organization_id = %s AND odc.status = true
            ORDER BY d.doc_name ASC
            """,
            (organization_id,),
        ).fetchall()


@router.put("/config")
def upsert_organization_document_config(
    payload: OrganizationDocumentConfigUpsert,
    current_admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    with get_transaction() as connection:
        organization = connection.execute(
            "SELECT id FROM organizations WHERE id = %s", (payload.organization_id,)
        ).fetchone()
        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        if not _document_service_active(connection, payload.organization_id):
            raise HTTPException(
                status_code=400,
                detail="Document Service must be enabled for this partner before configuring documents",
            )

        b2c = connection.execute(
            """
            SELECT esign_price, notary_price, stamp_denominations
            FROM doc_state_config
            WHERE doc_id = %s AND state_id = %s AND is_active = true
            """,
            (payload.doc_id, payload.state_id),
        ).fetchone()

        available = {
            "estamp_price": bool(b2c["stamp_denominations"]) if b2c else False,
            "esign_price": (b2c["esign_price"] is not None) if b2c else False,
            "enotary_price": (b2c["notary_price"] is not None) if b2c else False,
        }
        for field in ("estamp_price", "esign_price", "enotary_price"):
            if getattr(payload, field) is not None and not available[field]:
                raise HTTPException(
                    status_code=400,
                    detail=f"{PRICE_TYPE_BY_FIELD[field]} is not enabled for this document in this state",
                )

        existing = connection.execute(
            """
            SELECT id, base_price, estamp_price, esign_price, enotary_price
            FROM organization_document_config
            WHERE organization_id = %s AND state_id = %s AND doc_id = %s
            """,
            (payload.organization_id, payload.state_id, payload.doc_id),
        ).fetchone()

        row = connection.execute(
            """
            INSERT INTO organization_document_config (
                organization_id, state_id, doc_id, base_price, multi_language_enabled, available_languages,
                estamp_price, esign_price, enotary_price, status, updated_at
            )
            VALUES (
                %(organization_id)s, %(state_id)s, %(doc_id)s, %(base_price)s, %(multi_language_enabled)s, %(available_languages)s,
                %(estamp_price)s, %(esign_price)s, %(enotary_price)s, %(status)s, now()
            )
            ON CONFLICT (organization_id, state_id, doc_id) DO UPDATE SET
                base_price = EXCLUDED.base_price,
                multi_language_enabled = EXCLUDED.multi_language_enabled,
                available_languages = EXCLUDED.available_languages,
                estamp_price = EXCLUDED.estamp_price,
                esign_price = EXCLUDED.esign_price,
                enotary_price = EXCLUDED.enotary_price,
                status = EXCLUDED.status,
                updated_at = now()
            RETURNING id, organization_id, state_id, doc_id, base_price, multi_language_enabled, available_languages,
                      estamp_price, esign_price, enotary_price, status, updated_at
            """,
            payload.model_dump(),
        ).fetchone()

        for field, price_type in PRICE_TYPE_BY_FIELD.items():
            new_value = getattr(payload, field)
            old_value = existing[field] if existing else None
            old_float = float(old_value) if old_value is not None else None
            new_float = float(new_value) if new_value is not None else None
            if old_float != new_float:
                connection.execute(
                    """
                    INSERT INTO organization_document_config_price_history (config_id, price_type, price, changed_by)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (row["id"], price_type, new_value, current_admin["id"]),
                )

    return row


@router.get("/config/{config_id}/history")
def get_organization_document_config_price_history(
    config_id: UUID, price_type: str, limit: int = 20, offset: int = 0
) -> dict[str, Any]:
    if price_type not in PRICE_TYPE_BY_FIELD.values():
        raise HTTPException(status_code=400, detail="Invalid price_type")
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    with get_connection() as connection:
        total = connection.execute(
            """
            SELECT COUNT(*) AS n FROM organization_document_config_price_history
            WHERE config_id = %s AND price_type = %s
            """,
            (config_id, price_type),
        ).fetchone()["n"]
        items = connection.execute(
            """
            SELECT h.id, h.price, h.effective_from, h.created_at, u.full_name AS changed_by_name
            FROM organization_document_config_price_history h
            LEFT JOIN users u ON u.id = h.changed_by
            WHERE h.config_id = %s AND h.price_type = %s
            ORDER BY h.effective_from DESC
            LIMIT %s OFFSET %s
            """,
            (config_id, price_type, limit, offset),
        ).fetchall()
    return {"total": total, "items": items}
