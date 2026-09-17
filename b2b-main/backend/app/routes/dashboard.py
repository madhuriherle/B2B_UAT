from datetime import date
from typing import Any

from fastapi import APIRouter

from app.database import get_connection
from app.routes.partner import STATUS_CANCELLED, STATUS_COMPLETED, STATUS_DRAFT, STATUS_FAILED

router = APIRouter()

_ALLOWED_TREND_RANGES = (7, 30, 90)

# "Pending" = awaiting completion, across every service's status vocabulary
# (generic Submitted/In Progress, eStamp Bulk Pending/Processed, Manual
# eStamp Submitted/Stamp Processing/Stamp Completed/eSign Pending/eSign
# Completed, ...). Rather than enumerate every service's in-flight statuses
# — which grows every time a service adds one — exclude the statuses that
# are never "pending": Draft (not yet submitted) and the three terminal
# states. Everything else counts.
_NON_PENDING_ORDER_STATUSES = (STATUS_DRAFT, STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED)


@router.get("/summary")
def get_dashboard_summary() -> dict[str, Any]:
    with get_connection() as connection:
        summary = connection.execute(
            """
            SELECT
                (SELECT COUNT(*)::int FROM organizations) AS total_partners,
                (SELECT COUNT(*)::int FROM organizations WHERE is_active = true) AS active_partners,
                (SELECT COUNT(*)::int FROM organization_users) AS total_users,
                (SELECT COUNT(*)::int FROM organization_users WHERE is_active = true) AS active_users,
                (SELECT COUNT(*)::int FROM orders) AS total_orders,
                (SELECT COUNT(*)::int FROM orders WHERE status = %(draft)s) AS draft_orders,
                (SELECT COUNT(*)::int FROM orders WHERE status = %(completed)s) AS completed_orders,
                (SELECT COUNT(*)::int FROM orders WHERE NOT (LOWER(status) = ANY(%(non_pending)s))) AS pending_orders,
                (SELECT COUNT(*)::int FROM b2b_stamp_denomination) AS total_stamp_configurations,
                COALESCE((SELECT SUM(balance) FROM organization_wallet), 0) AS total_wallet_balance,
                COALESCE((SELECT SUM(amount) FROM orders WHERE status = %(completed)s), 0) AS revenue
            """,
            {
                "draft": STATUS_DRAFT,
                "completed": STATUS_COMPLETED,
                "non_pending": [s.lower() for s in _NON_PENDING_ORDER_STATUSES],
            },
        ).fetchone()

        orders_by_service = connection.execute(
            """
            SELECT service_name, COUNT(*)::int AS order_count
            FROM orders
            GROUP BY service_name
            ORDER BY order_count DESC
            """
        ).fetchall()

        recent_activity = connection.execute(
            """
            SELECT 'Partner Created' AS action,
                   organization_name AS org,
                   created_at,
                   'partner' AS type
            FROM organizations
            UNION ALL
            SELECT 'User Created' AS action,
                   u.full_name AS org,
                   ou.created_at,
                   'user' AS type
            FROM organization_users ou
            JOIN users u ON u.id = ou.user_id
            UNION ALL
            SELECT 'Wallet Credited' AS action,
                   o.organization_name AS org,
                   wt.created_at,
                   'wallet' AS type
            FROM wallet_transactions wt
            JOIN organizations o ON o.id = wt.organization_id
            WHERE wt.type = 'credit'
            UNION ALL
            SELECT 'Stamp Denomination Added' AS action,
                   s.state_name AS org,
                   b.created_at,
                   'stamp' AS type
            FROM b2b_stamp_denomination b
            JOIN state s ON s.id = b.state_id
            ORDER BY created_at DESC
            LIMIT 8
            """
        ).fetchall()

    return {"summary": summary, "orders_by_service": orders_by_service, "recent_activity": recent_activity}


@router.get("/trends")
def get_dashboard_trends(range_days: int = 7) -> dict[str, Any]:
    days = range_days if range_days in _ALLOWED_TREND_RANGES else 7

    with get_connection() as connection:
        rows = connection.execute(
            """
            WITH days AS (
                SELECT generate_series(
                    CURRENT_DATE - (%(days)s - 1) * INTERVAL '1 day',
                    CURRENT_DATE,
                    INTERVAL '1 day'
                )::date AS day
            ),
            daily_orders AS (
                SELECT
                    created_at::date AS day,
                    COUNT(*)::int AS order_count,
                    COALESCE(SUM(amount) FILTER (WHERE status = %(completed)s), 0) AS revenue
                FROM orders
                WHERE created_at::date >= CURRENT_DATE - (%(days)s - 1) * INTERVAL '1 day'
                GROUP BY created_at::date
            ),
            daily_partners AS (
                SELECT created_at::date AS day, COUNT(*)::int AS new_partners
                FROM organizations
                WHERE created_at::date >= CURRENT_DATE - (%(days)s - 1) * INTERVAL '1 day'
                GROUP BY created_at::date
            )
            SELECT
                days.day,
                COALESCE(daily_orders.order_count, 0) AS order_count,
                COALESCE(daily_orders.revenue, 0) AS revenue,
                COALESCE(daily_partners.new_partners, 0) AS new_partners
            FROM days
            LEFT JOIN daily_orders ON daily_orders.day = days.day
            LEFT JOIN daily_partners ON daily_partners.day = days.day
            ORDER BY days.day
            """,
            {"days": days, "completed": STATUS_COMPLETED},
        ).fetchall()

    return {
        "range_days": days,
        "points": [
            {
                "date": row["day"].isoformat() if isinstance(row["day"], date) else row["day"],
                "orders": row["order_count"],
                "revenue": float(row["revenue"]),
                "new_partners": row["new_partners"],
            }
            for row in rows
        ],
    }
