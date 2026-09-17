from typing import Any
from uuid import UUID

from fastapi import APIRouter

from app.database import get_connection

router = APIRouter()

# Every price an admin can set lives in its own per-feature *_price_history
# table (Stamp Denominations, per-partner Service Pricing, per-partner
# Document Service pricing) — each already populated by its own route. This
# endpoint just merges all three into one chronological feed rather than
# introducing a new table of its own.
_PRICE_HISTORY_UNION = """
    SELECT
        h.id,
        'Stamp Denomination' AS category,
        s.state_name AS label,
        h.stamp_value AS price,
        h.effective_from,
        u.full_name AS changed_by_name
    FROM stamp_denomination_price_history h
    JOIN b2b_stamp_denomination b ON b.id = h.stamp_denomination_id
    JOIN state s ON s.id = b.state_id
    LEFT JOIN users u ON u.id = h.changed_by

    UNION ALL

    SELECT
        h.id,
        'Service Pricing' AS category,
        o.organization_name || ' — ' || h.service_name AS label,
        h.price,
        h.effective_from,
        u.full_name AS changed_by_name
    FROM organization_service_price_history h
    JOIN organizations o ON o.id = h.organization_id
    LEFT JOIN users u ON u.id = h.changed_by

    UNION ALL

    SELECT
        h.id,
        'Document Pricing' AS category,
        o.organization_name || ' — ' || d.doc_name || ' (' || h.price_type || ')' AS label,
        h.price,
        h.effective_from,
        u.full_name AS changed_by_name
    FROM organization_document_config_price_history h
    JOIN organization_document_config c ON c.id = h.config_id
    JOIN organizations o ON o.id = c.organization_id
    JOIN document d ON d.doc_id = c.doc_id
    LEFT JOIN users u ON u.id = h.changed_by
"""

# Same two categories as above, scoped to one organization_id (%s appears
# twice, once per leg) — used by the Edit Partner popup's "Price History" (see
# EditPartnerModal.jsx) so Super Admin can review one partner's own pricing
# changes without any other partner's mixed in. "Stamp Denomination" is
# deliberately left out: stamp denominations are global per-state master
# data, never scoped to a single organization, so they can't be attributed to
# "this partner's" history at all — including them here would either leak
# every partner's shared data into one partner's view, or require an
# arbitrary include/exclude choice that has no correct answer.
_ORG_PRICE_HISTORY_UNION = """
    SELECT
        h.id,
        'Service Pricing' AS category,
        h.service_name AS label,
        h.price,
        h.effective_from,
        u.full_name AS changed_by_name
    FROM organization_service_price_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.organization_id = %s

    UNION ALL

    SELECT
        h.id,
        'Document Pricing' AS category,
        d.doc_name || ' (' || h.price_type || ')' AS label,
        h.price,
        h.effective_from,
        u.full_name AS changed_by_name
    FROM organization_document_config_price_history h
    JOIN organization_document_config c ON c.id = h.config_id
    JOIN document d ON d.doc_id = c.doc_id
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE c.organization_id = %s
"""


@router.get("")
def list_price_history(organization_id: UUID | None = None, limit: int = 20, offset: int = 0) -> dict[str, Any]:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    union_sql = _PRICE_HISTORY_UNION if organization_id is None else _ORG_PRICE_HISTORY_UNION
    filter_params = () if organization_id is None else (organization_id, organization_id)
    with get_connection() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) AS n FROM ({union_sql}) combined", filter_params
        ).fetchone()["n"]
        items = connection.execute(
            f"""
            SELECT * FROM ({union_sql}) combined
            ORDER BY effective_from DESC
            LIMIT %s OFFSET %s
            """,
            filter_params + (limit, offset),
        ).fetchall()
    return {"total": total, "items": items}
