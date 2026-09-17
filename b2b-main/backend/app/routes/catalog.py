from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.database import get_connection

router = APIRouter()

# NOT the same concept as the "eStamp" order service (single-document,
# SignDesk-integrated — see stamp_service.py/b2b_stamp_transaction). This is
# the physical/procedural stamp mechanism a STATE uses for eStamp Bulk
# orders (see partner.create_bulk_estamp_order, b2b_state_stamp_config).
STAMP_PAPER_TYPE_TRADITIONAL = "Traditional Stamp Paper"
STAMP_PAPER_TYPE_ESTAMP = "eStamp"
STAMP_PAPER_TYPES = (STAMP_PAPER_TYPE_TRADITIONAL, STAMP_PAPER_TYPE_ESTAMP)


# States is plain reference data (no per-org/per-role sensitivity) needed by
# every logged-in role — e.g. PartnerCreateRetailer.jsx (role="partner")
# populates its state dropdown from this endpoint. It's split into its own
# router so it can require just "any authenticated user" instead of the
# admin_only dependency the rest of this router is mounted with in main.py
# (those other endpoints list ALL users/documents/arbitrary users' payments,
# which do need to stay admin-only).
public_router = APIRouter()


@public_router.get("/states")
def list_states(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    # stamp_paper_type defaults to Traditional Stamp Paper for any state
    # Super Admin hasn't explicitly configured yet (see
    # b2b_state_stamp_config's own comment in schema.sql) — every state that
    # predates this feature keeps behaving exactly as it always did, nothing
    # silently blocks an existing Traditional Stamp Paper flow.
    with get_connection() as connection:
        return connection.execute(
            f"""
            SELECT s.id, s.state_name,
                   COALESCE(c.stamp_paper_type, '{STAMP_PAPER_TYPE_TRADITIONAL}') AS stamp_paper_type,
                   (c.state_id IS NOT NULL) AS is_configured
            FROM state s
            LEFT JOIN b2b_state_stamp_config c ON c.state_id = s.id
            ORDER BY s.state_name ASC
            """
        ).fetchall()


class StatePricingConfigUpdate(BaseModel):
    stamp_paper_type: str


class CustomStampPaperTypeCreate(BaseModel):
    name: str


@router.get("/stamp-paper-types")
def list_stamp_paper_types() -> list[str]:
    """The two built-in, functional types plus any admin-added custom names
    (labels only — see b2b_custom_stamp_paper_type's own comment in
    schema.sql for why a custom name has no real order-creation flow behind
    it). Backs the "Stamp Paper Type" radio list in StampDenomination.jsx."""
    with get_connection() as connection:
        custom = connection.execute(
            "SELECT name FROM b2b_custom_stamp_paper_type ORDER BY created_at ASC"
        ).fetchall()
    return list(STAMP_PAPER_TYPES) + [row["name"] for row in custom]


@router.post("/stamp-paper-types")
def create_custom_stamp_paper_type(payload: CustomStampPaperTypeCreate) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Type name is required")
    if len(name) > 50:
        raise HTTPException(status_code=400, detail="Type name must be 50 characters or fewer")
    if name.lower() in (t.lower() for t in STAMP_PAPER_TYPES):
        raise HTTPException(status_code=400, detail=f"'{name}' is already a built-in stamp paper type")
    with get_connection() as connection:
        existing = connection.execute(
            "SELECT id FROM b2b_custom_stamp_paper_type WHERE lower(name) = lower(%s)", (name,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"'{name}' already exists")
        return connection.execute(
            "INSERT INTO b2b_custom_stamp_paper_type (name) VALUES (%s) RETURNING id, name, created_at",
            (name,),
        ).fetchone()


@router.put("/states/{state_id}/stamp-paper-type")
def set_state_stamp_paper_type(state_id: UUID, payload: StatePricingConfigUpdate) -> dict[str, Any]:
    with get_connection() as connection:
        valid_types = set(STAMP_PAPER_TYPES) | {
            row["name"] for row in connection.execute("SELECT name FROM b2b_custom_stamp_paper_type").fetchall()
        }
        if payload.stamp_paper_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"stamp_paper_type must be one of {sorted(valid_types)}")
        state = connection.execute("SELECT id FROM state WHERE id = %s", (state_id,)).fetchone()
        if not state:
            raise HTTPException(status_code=404, detail="State not found")
        return connection.execute(
            """
            INSERT INTO b2b_state_stamp_config (state_id, stamp_paper_type, updated_at)
            VALUES (%s, %s, now())
            ON CONFLICT (state_id) DO UPDATE SET stamp_paper_type = EXCLUDED.stamp_paper_type, updated_at = now()
            RETURNING state_id, stamp_paper_type, updated_at
            """,
            (state_id, payload.stamp_paper_type),
        ).fetchone()


@router.get("/users")
def list_users() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT
                u.id,
                u.full_name,
                u.email,
                u.role,
                r.role_name
            FROM users u
            LEFT JOIN role r ON r.role_name = u.role
            ORDER BY u.created_at DESC NULLS LAST
            """
        ).fetchall()


@router.get("/documents")
def list_documents() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT
                d.*,
                c.category_name
            FROM document d
            LEFT JOIN category c ON c.category_id = d.category_id
            ORDER BY d.doc_name ASC
            """
        ).fetchall()


@router.get("/document-stamp-denominations")
def list_document_stamp_denominations(
    doc_id: str | None = None,
    state_id: UUID | None = None,
) -> list[dict[str, Any]]:
    params = {}
    filters = []

    if doc_id:
        params["doc_id"] = doc_id
        filters.append("dsd.doc_id = %(doc_id)s")
    if state_id:
        params["state_id"] = state_id
        filters.append("dsd.state_id = %(state_id)s")

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""

    with get_connection() as connection:
        return connection.execute(
            f"""
            SELECT
                dsd.id,
                dsd.doc_id,
                d.doc_name,
                dsd.state_id,
                s.state_name,
                dsd.stamp_denomination_id,
                sd.denomination,
                sd.amount
            FROM document_stamp_denomination dsd
            JOIN document d ON d.doc_id = dsd.doc_id
            JOIN state s ON s.id = dsd.state_id
            JOIN stamp_denomination sd ON sd.id = dsd.stamp_denomination_id
            {where_clause}
            ORDER BY s.state_name ASC, d.doc_name ASC
            """,
            params,
        ).fetchall()


@router.get("/user-documents/{user_id}")
def list_user_documents(user_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT
                ud.*,
                d.doc_name,
                d.category_id,
                s.state_name
            FROM user_doc ud
            JOIN document d ON d.doc_id = ud.doc_id
            LEFT JOIN state s ON s.id = ud.state_id
            WHERE ud.user_id = %s
            ORDER BY ud.created_at DESC NULLS LAST
            """,
            (user_id,),
        ).fetchall()


@router.get("/payments/{user_doc_id}")
def list_payments(user_doc_id: UUID) -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute(
            """
            SELECT
                pt.*,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', ptm.id,
                            'meta_key', ptm.meta_key,
                            'meta_value', ptm.meta_value
                        )
                    ) FILTER (WHERE ptm.id IS NOT NULL),
                    '[]'
                ) AS meta,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', rt.id,
                            'payment_id', rt.payment_id,
                            'user_doc_id', rt.user_doc_id,
                            'razorpay_payment_id', rt.razorpay_payment_id,
                            'razorpay_order_id', rt.razorpay_order_id,
                            'status', rt.status
                        )
                    ) FILTER (WHERE rt.id IS NOT NULL),
                    '[]'
                ) AS razorpay_transactions
            FROM payment_transaction pt
            LEFT JOIN payment_transaction_meta ptm ON ptm.payment_id = pt.id
            LEFT JOIN razorpay_transaction rt ON rt.payment_id = pt.id
            WHERE pt.user_doc_id = %s
            GROUP BY pt.id
            ORDER BY pt.created_at DESC NULLS LAST
            """,
            (user_doc_id,),
        ).fetchall()
