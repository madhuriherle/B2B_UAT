from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from psycopg.errors import UniqueViolation

from app.database import get_connection, get_transaction
from app.validators import validate_mobile

router = APIRouter()

VENDOR_TYPES = ("Internal Team", "Third-Party Vendor")
PAYMENT_MODES = ("Wallet", "PPS")

# Mirrors partner.py's ORDER_STATUSES; duplicated as a literal for the same
# reason organizations.py does — importing it would risk a circular import.
STATUS_COMPLETED = "Completed"
INACTIVE_ORDER_STATUSES = ("Completed", "Cancelled", "Failed")


class VendorCreate(BaseModel):
    vendor_name: str
    vendor_type: str
    contact_person: str | None = None
    email: EmailStr
    mobile: str | None = None
    gst_number: str | None = None
    address: str | None = None
    city: str | None = None
    state_id: UUID | None = None
    payment_mode: str = "Wallet"
    is_active: bool = True

    _validate_mobile = field_validator("mobile")(validate_mobile)


class VendorUpdate(BaseModel):
    vendor_name: str | None = None
    vendor_type: str | None = None
    contact_person: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    gst_number: str | None = None
    address: str | None = None
    city: str | None = None
    state_id: UUID | None = None
    payment_mode: str | None = None
    is_active: bool | None = None

    _validate_mobile = field_validator("mobile")(validate_mobile)


class StateAssignmentItem(BaseModel):
    state_id: UUID
    is_active: bool = True


class VendorStatesUpdate(BaseModel):
    states: list[StateAssignmentItem] = []


class WalletTransactionCreate(BaseModel):
    type: str
    amount: float
    description: str | None = None


class OrderAssignmentCreate(BaseModel):
    order_id: UUID
    state_id: UUID | None = None
    service_name: str | None = None
    notes: str | None = None


class OrderAssignmentUpdate(BaseModel):
    vendor_id: UUID | None = None
    state_id: UUID | None = None
    service_name: str | None = None
    notes: str | None = None


def _require_vendor(connection, vendor_id: UUID) -> None:
    vendor = connection.execute("SELECT id FROM vendors WHERE id = %s", (vendor_id,)).fetchone()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")


# =========================================
# Vendor CRUD
# =========================================


@router.get("")
def list_vendors() -> list[dict[str, Any]]:
    sql = """
        SELECT
            v.id,
            v.vendor_name,
            v.vendor_type,
            v.contact_person,
            v.email,
            v.mobile,
            v.gst_number,
            v.address,
            v.city,
            v.state_id,
            s.state_name,
            v.payment_mode,
            v.is_active,
            v.created_at,
            COALESCE(vw.balance, 0) AS wallet_balance,
            COALESCE(states_agg.state_names, ARRAY[]::text[]) AS assigned_state_names,
            COALESCE(active_orders.cnt, 0) AS active_orders
        FROM vendors v
        LEFT JOIN state s ON s.id = v.state_id
        LEFT JOIN vendor_wallet vw ON vw.vendor_id = v.id
        LEFT JOIN (
            SELECT vsa.vendor_id, array_agg(st.state_name ORDER BY st.state_name) AS state_names
            FROM vendor_state_assignments vsa
            JOIN state st ON st.id = vsa.state_id
            WHERE vsa.is_active = true
            GROUP BY vsa.vendor_id
        ) states_agg ON states_agg.vendor_id = v.id
        LEFT JOIN (
            SELECT voa.vendor_id, COUNT(*)::int AS cnt
            FROM vendor_order_assignments voa
            JOIN orders o ON o.id = voa.order_id
            WHERE NOT (o.status = ANY(%(inactive_statuses)s))
            GROUP BY voa.vendor_id
        ) active_orders ON active_orders.vendor_id = v.id
        ORDER BY v.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql, {"inactive_statuses": list(INACTIVE_ORDER_STATUSES)}).fetchall()


@router.post("", status_code=201)
def create_vendor(payload: VendorCreate) -> dict[str, Any]:
    if payload.vendor_type not in VENDOR_TYPES:
        raise HTTPException(status_code=400, detail=f"vendor_type must be one of {VENDOR_TYPES}")
    if payload.payment_mode not in PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"payment_mode must be one of {PAYMENT_MODES}")

    sql = """
        INSERT INTO vendors (
            vendor_name, vendor_type, contact_person, email, mobile,
            gst_number, address, city, state_id, payment_mode, is_active
        )
        VALUES (
            %(vendor_name)s, %(vendor_type)s, %(contact_person)s, %(email)s, %(mobile)s,
            %(gst_number)s, %(address)s, %(city)s, %(state_id)s, %(payment_mode)s, %(is_active)s
        )
        RETURNING *
    """
    with get_connection() as connection:
        try:
            return connection.execute(sql, payload.model_dump()).fetchone()
        except UniqueViolation:
            raise HTTPException(status_code=409, detail=f"A vendor with email '{payload.email}' already exists")


# =========================================
# Order assignments — manual admin assignment of an order to a vendor.
# GET /order-assignments (no vendor_id filter) MUST stay registered before
# GET /{vendor_id} below it in this file — both are single-segment paths
# under this router, and FastAPI matches literal routes registered first.
# =========================================

_ORDER_ASSIGNMENT_SELECT = """
    SELECT
        voa.id AS assignment_id,
        voa.vendor_id,
        v.vendor_name,
        voa.order_id,
        o.order_no,
        o.customer_name,
        org.organization_name AS partner_name,
        voa.state_id,
        st.state_name,
        voa.service_name,
        voa.notes,
        voa.assigned_at,
        o.status AS current_status,
        o.amount,
        CASE WHEN o.status = 'Completed' THEN o.updated_at ELSE NULL END AS completed_at
    FROM vendor_order_assignments voa
    JOIN orders o ON o.id = voa.order_id
    JOIN organizations org ON org.id = o.organization_id
    JOIN vendors v ON v.id = voa.vendor_id
    LEFT JOIN state st ON st.id = voa.state_id
"""


@router.get("/order-assignments")
def list_order_assignments(
    vendor_id: UUID | None = None,
    status: str | None = None,
    state_id: UUID | None = None,
    service_name: str | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {}
    filters = []
    if vendor_id:
        params["vendor_id"] = vendor_id
        filters.append("voa.vendor_id = %(vendor_id)s")
    if status:
        params["status"] = status
        filters.append("o.status = %(status)s")
    if state_id:
        params["state_id"] = state_id
        filters.append("voa.state_id = %(state_id)s")
    if service_name:
        params["service_name"] = service_name
        filters.append("voa.service_name = %(service_name)s")
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    sql = f"{_ORDER_ASSIGNMENT_SELECT} {where} ORDER BY voa.assigned_at DESC"
    with get_connection() as connection:
        return connection.execute(sql, params).fetchall()


@router.post("/{vendor_id}/order-assignments", status_code=201)
def create_order_assignment(vendor_id: UUID, payload: OrderAssignmentCreate) -> dict[str, Any]:
    with get_transaction() as connection:
        _require_vendor(connection, vendor_id)
        order = connection.execute("SELECT id FROM orders WHERE id = %s", (payload.order_id,)).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        try:
            inserted = connection.execute(
                """
                INSERT INTO vendor_order_assignments (vendor_id, order_id, state_id, service_name, notes)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (vendor_id, payload.order_id, payload.state_id, payload.service_name, payload.notes),
            ).fetchone()
        except UniqueViolation:
            raise HTTPException(status_code=409, detail="This order is already assigned to a vendor")

        return connection.execute(f"{_ORDER_ASSIGNMENT_SELECT} WHERE voa.id = %s", (inserted["id"],)).fetchone()


@router.patch("/order-assignments/{assignment_id}")
def update_order_assignment(assignment_id: UUID, payload: OrderAssignmentUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    assignments = [f"{field} = %({field})s" for field in data]
    data["assignment_id"] = assignment_id
    sql = f"""
        UPDATE vendor_order_assignments
        SET {", ".join(assignments)}, updated_at = now()
        WHERE id = %(assignment_id)s
        RETURNING id
    """
    with get_transaction() as connection:
        updated = connection.execute(sql, data).fetchone()
        if not updated:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return connection.execute(f"{_ORDER_ASSIGNMENT_SELECT} WHERE voa.id = %s", (updated["id"],)).fetchone()


# =========================================
# Vendor CRUD (get/update single) — registered after the literal
# /order-assignments and /wallets/summary routes above for the same
# single-segment-path-collision reason noted above.
# =========================================


@router.get("/{vendor_id}")
def get_vendor(vendor_id: UUID) -> dict[str, Any]:
    sql = """
        SELECT v.*, s.state_name
        FROM vendors v
        LEFT JOIN state s ON s.id = v.state_id
        WHERE v.id = %s
    """
    with get_connection() as connection:
        vendor = connection.execute(sql, (vendor_id,)).fetchone()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


@router.patch("/{vendor_id}")
def update_vendor(vendor_id: UUID, payload: VendorUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    if "vendor_type" in data and data["vendor_type"] not in VENDOR_TYPES:
        raise HTTPException(status_code=400, detail=f"vendor_type must be one of {VENDOR_TYPES}")
    if "payment_mode" in data and data["payment_mode"] not in PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"payment_mode must be one of {PAYMENT_MODES}")

    assignments = [f"{field} = %({field})s" for field in data]
    data["vendor_id"] = vendor_id
    sql = f"""
        UPDATE vendors
        SET {", ".join(assignments)}, updated_at = now()
        WHERE id = %(vendor_id)s
        RETURNING *
    """
    with get_connection() as connection:
        vendor = connection.execute(sql, data).fetchone()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


# =========================================
# Assigned States
# Same "show every catalog entry with is_active true/false, upsert on save"
# shape as organizations.py's service pricing endpoints — never deletes a
# row, just flips is_active, so "Assigned Date" reflects first assignment.
# =========================================


@router.get("/{vendor_id}/states")
def get_vendor_states(vendor_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _require_vendor(connection, vendor_id)
        all_states = connection.execute("SELECT id, state_name FROM state ORDER BY state_name ASC").fetchall()
        assigned = {
            row["state_id"]: row
            for row in connection.execute(
                "SELECT state_id, is_active, assigned_at FROM vendor_state_assignments WHERE vendor_id = %s",
                (vendor_id,),
            ).fetchall()
        }

    states = [
        {
            "state_id": s["id"],
            "state_name": s["state_name"],
            "is_active": assigned.get(s["id"], {}).get("is_active", False),
            "assigned_at": assigned.get(s["id"], {}).get("assigned_at"),
        }
        for s in all_states
    ]
    return {"states": states}


@router.put("/{vendor_id}/states")
def update_vendor_states(vendor_id: UUID, payload: VendorStatesUpdate) -> dict[str, Any]:
    with get_transaction() as connection:
        _require_vendor(connection, vendor_id)
        for item in payload.states:
            connection.execute(
                """
                INSERT INTO vendor_state_assignments (vendor_id, state_id, is_active)
                VALUES (%s, %s, %s)
                ON CONFLICT (vendor_id, state_id) DO UPDATE SET is_active = EXCLUDED.is_active
                """,
                (vendor_id, item.state_id, item.is_active),
            )
    return get_vendor_states(vendor_id)


# =========================================
# Wallet — exact clone of organizations.py's wallet pair, renamed tables.
# =========================================


@router.get("/wallets/summary")
def list_vendor_wallet_summary() -> list[dict[str, Any]]:
    sql = """
        SELECT
            v.id AS vendor_id,
            v.vendor_name,
            COALESCE(w.balance, 0) AS balance,
            COALESCE(agg.total_credits, 0) AS total_credits,
            COALESCE(agg.total_debits, 0) AS total_debits
        FROM vendors v
        LEFT JOIN vendor_wallet w ON w.vendor_id = v.id
        LEFT JOIN (
            SELECT
                vendor_id,
                SUM(amount) FILTER (WHERE type = 'credit') AS total_credits,
                SUM(amount) FILTER (WHERE type = 'debit') AS total_debits
            FROM vendor_wallet_transactions
            GROUP BY vendor_id
        ) agg ON agg.vendor_id = v.id
        WHERE v.payment_mode IS DISTINCT FROM 'PPS'
        ORDER BY v.vendor_name ASC
    """
    with get_connection() as connection:
        return connection.execute(sql).fetchall()


@router.get("/{vendor_id}/wallet")
def get_vendor_wallet(vendor_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _require_vendor(connection, vendor_id)

        wallet = connection.execute(
            "SELECT vendor_id, balance, updated_at FROM vendor_wallet WHERE vendor_id = %s",
            (vendor_id,),
        ).fetchone()
        if not wallet:
            wallet = {"vendor_id": vendor_id, "balance": 0, "updated_at": None}

        transactions = connection.execute(
            """
            SELECT id, vendor_id, type, amount, balance_after, description, created_at
            FROM vendor_wallet_transactions
            WHERE vendor_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (vendor_id,),
        ).fetchall()

        totals = connection.execute(
            """
            SELECT
                COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits,
                COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) AS total_debits
            FROM vendor_wallet_transactions
            WHERE vendor_id = %s
            """,
            (vendor_id,),
        ).fetchone()

    last_credit = next((t for t in transactions if t["type"] == "credit"), None)

    return {
        **wallet,
        **totals,
        "transactions": transactions,
        "last_recharge_at": last_credit["created_at"] if last_credit else None,
    }


@router.post("/{vendor_id}/wallet/transactions", status_code=201)
def create_vendor_wallet_transaction(vendor_id: UUID, payload: WalletTransactionCreate) -> dict[str, Any]:
    if payload.type not in ("credit", "debit"):
        raise HTTPException(status_code=400, detail="type must be 'credit' or 'debit'")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    with get_transaction() as connection:
        _require_vendor(connection, vendor_id)

        connection.execute(
            "INSERT INTO vendor_wallet (vendor_id, balance) VALUES (%s, 0) ON CONFLICT (vendor_id) DO NOTHING",
            (vendor_id,),
        )
        current = connection.execute(
            "SELECT balance FROM vendor_wallet WHERE vendor_id = %s FOR UPDATE",
            (vendor_id,),
        ).fetchone()

        delta = payload.amount if payload.type == "credit" else -payload.amount
        new_balance = float(current["balance"]) + delta
        if new_balance < 0:
            raise HTTPException(status_code=400, detail="Insufficient wallet balance")

        connection.execute(
            "UPDATE vendor_wallet SET balance = %s, updated_at = now() WHERE vendor_id = %s",
            (new_balance, vendor_id),
        )
        transaction = connection.execute(
            """
            INSERT INTO vendor_wallet_transactions (vendor_id, type, amount, balance_after, description)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, vendor_id, type, amount, balance_after, description, created_at
            """,
            (vendor_id, payload.type, payload.amount, new_balance, payload.description),
        ).fetchone()

    return transaction

# =========================================
# Revenue
# =========================================


@router.get("/{vendor_id}/revenue")
def get_vendor_revenue(vendor_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _require_vendor(connection, vendor_id)

        totals = connection.execute(
            """
            SELECT
                COALESCE(SUM(o.amount) FILTER (WHERE o.status = %(completed)s), 0) AS total_revenue,
                COALESCE(SUM(o.amount) FILTER (
                    WHERE o.status = %(completed)s AND o.updated_at >= date_trunc('month', CURRENT_DATE)
                ), 0) AS this_month_revenue,
                COALESCE(SUM(o.amount) FILTER (
                    WHERE o.status = %(completed)s AND o.updated_at::date = CURRENT_DATE
                ), 0) AS today_revenue
            FROM vendor_order_assignments voa
            JOIN orders o ON o.id = voa.order_id
            WHERE voa.vendor_id = %(vendor_id)s
            """,
            {"vendor_id": vendor_id, "completed": STATUS_COMPLETED},
        ).fetchone()

        by_service = connection.execute(
            """
            SELECT COALESCE(voa.service_name, o.service_name, 'Unspecified') AS service_name,
                   COALESCE(SUM(o.amount), 0) AS revenue
            FROM vendor_order_assignments voa
            JOIN orders o ON o.id = voa.order_id
            WHERE voa.vendor_id = %(vendor_id)s AND o.status = %(completed)s
            GROUP BY COALESCE(voa.service_name, o.service_name, 'Unspecified')
            ORDER BY revenue DESC
            """,
            {"vendor_id": vendor_id, "completed": STATUS_COMPLETED},
        ).fetchall()

    return {**totals, "by_service": by_service}


@router.get("/{vendor_id}/revenue/trend")
def get_vendor_revenue_trend(vendor_id: UUID, days: int = 30) -> dict[str, Any]:
    days = days if days in (7, 30, 90) else 30
    with get_connection() as connection:
        _require_vendor(connection, vendor_id)

        rows = connection.execute(
            """
            WITH days AS (
                SELECT generate_series(
                    CURRENT_DATE - (%(days)s - 1) * INTERVAL '1 day',
                    CURRENT_DATE,
                    INTERVAL '1 day'
                )::date AS day
            ),
            daily_revenue AS (
                SELECT o.updated_at::date AS day, COALESCE(SUM(o.amount), 0) AS revenue
                FROM vendor_order_assignments voa
                JOIN orders o ON o.id = voa.order_id
                WHERE voa.vendor_id = %(vendor_id)s
                  AND o.status = %(completed)s
                  AND o.updated_at::date >= CURRENT_DATE - (%(days)s - 1) * INTERVAL '1 day'
                GROUP BY o.updated_at::date
            )
            SELECT days.day, COALESCE(daily_revenue.revenue, 0) AS revenue
            FROM days
            LEFT JOIN daily_revenue ON daily_revenue.day = days.day
            ORDER BY days.day
            """,
            {"vendor_id": vendor_id, "completed": STATUS_COMPLETED, "days": days},
        ).fetchall()

    return {
        "days": days,
        "points": [{"date": row["day"].isoformat(), "revenue": float(row["revenue"])} for row in rows],
    }


# =========================================
# Timeline — synthesized from real timestamps, same UNION ALL pattern as
# organizations.py's Partner Profile timeline endpoint.
# =========================================


@router.get("/{vendor_id}/timeline")
def get_vendor_timeline(vendor_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 200))
    with get_connection() as connection:
        _require_vendor(connection, vendor_id)

        rows = connection.execute(
            """
            SELECT 'Vendor Created' AS action, v.vendor_name AS label, v.created_at
            FROM vendors v WHERE v.id = %(vendor_id)s

            UNION ALL
            SELECT 'State Assigned' AS action, st.state_name AS label, vsa.assigned_at AS created_at
            FROM vendor_state_assignments vsa
            JOIN state st ON st.id = vsa.state_id
            WHERE vsa.vendor_id = %(vendor_id)s

            UNION ALL
            SELECT
                CASE WHEN wt.type = 'credit' THEN 'Wallet Credited' ELSE 'Wallet Debited' END AS action,
                COALESCE(wt.description, '') AS label,
                wt.created_at
            FROM vendor_wallet_transactions wt
            WHERE wt.vendor_id = %(vendor_id)s

            UNION ALL
            SELECT 'Order Assigned' AS action, o.order_no AS label, voa.assigned_at AS created_at
            FROM vendor_order_assignments voa
            JOIN orders o ON o.id = voa.order_id
            WHERE voa.vendor_id = %(vendor_id)s

            UNION ALL
            SELECT 'Order Completed' AS action, o.order_no AS label, o.updated_at AS created_at
            FROM vendor_order_assignments voa
            JOIN orders o ON o.id = voa.order_id
            WHERE voa.vendor_id = %(vendor_id)s AND o.status = %(completed)s

            ORDER BY created_at DESC
            LIMIT %(limit)s
            """,
            {"vendor_id": vendor_id, "completed": STATUS_COMPLETED, "limit": limit},
        ).fetchall()

    return rows


# =========================================
# Reports — cross-vendor aggregate for the Vendor Reports page.
# =========================================


@router.get("/reports/summary")
def get_vendor_reports_summary() -> dict[str, Any]:
    with get_connection() as connection:
        by_state = connection.execute(
            """
            SELECT COALESCE(st.state_name, 'Unspecified') AS state_name, COUNT(*)::int AS order_count
            FROM vendor_order_assignments voa
            LEFT JOIN state st ON st.id = voa.state_id
            GROUP BY COALESCE(st.state_name, 'Unspecified')
            ORDER BY order_count DESC
            """
        ).fetchall()

        by_service = connection.execute(
            """
            SELECT COALESCE(voa.service_name, 'Unspecified') AS service_name, COUNT(*)::int AS order_count
            FROM vendor_order_assignments voa
            GROUP BY COALESCE(voa.service_name, 'Unspecified')
            ORDER BY order_count DESC
            """
        ).fetchall()

        performance = connection.execute(
            """
            SELECT
                v.id AS vendor_id,
                v.vendor_name,
                COUNT(voa.id)::int AS total_assigned,
                COUNT(*) FILTER (WHERE o.status = %(completed)s)::int AS completed,
                CASE WHEN COUNT(voa.id) = 0 THEN 0
                     ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = %(completed)s) / COUNT(voa.id), 1)
                END AS completion_rate
            FROM vendors v
            LEFT JOIN vendor_order_assignments voa ON voa.vendor_id = v.id
            LEFT JOIN orders o ON o.id = voa.order_id
            GROUP BY v.id, v.vendor_name
            ORDER BY total_assigned DESC
            """,
            {"completed": STATUS_COMPLETED},
        ).fetchall()

        totals = connection.execute(
            """
            SELECT
                COALESCE(SUM(o.amount) FILTER (WHERE o.status = %(completed)s), 0) AS total_revenue,
                COALESCE(SUM(o.amount) FILTER (
                    WHERE o.status = %(completed)s AND o.updated_at >= date_trunc('month', CURRENT_DATE)
                ), 0) AS this_month_revenue,
                COALESCE(SUM(o.amount) FILTER (
                    WHERE o.status = %(completed)s AND o.updated_at::date = CURRENT_DATE
                ), 0) AS today_revenue,
                COUNT(*)::int AS total_assignments,
                COUNT(*) FILTER (WHERE o.status = %(completed)s)::int AS total_completed,
                AVG(o.updated_at - voa.assigned_at) FILTER (WHERE o.status = %(completed)s) AS avg_completion_interval
            FROM vendor_order_assignments voa
            JOIN orders o ON o.id = voa.order_id
            """,
            {"completed": STATUS_COMPLETED},
        ).fetchone()

    overall_completion_rate = (
        round(100.0 * totals["total_completed"] / totals["total_assignments"], 1)
        if totals["total_assignments"]
        else 0
    )
    avg_completion_hours = (
        totals["avg_completion_interval"].total_seconds() / 3600 if totals["avg_completion_interval"] else None
    )

    return {
        "orders_by_state": by_state,
        "orders_by_service": by_service,
        "vendor_performance": performance,
        "total_revenue": totals["total_revenue"],
        "this_month_revenue": totals["this_month_revenue"],
        "today_revenue": totals["today_revenue"],
        "completion_rate": overall_completion_rate,
        "avg_completion_hours": avg_completion_hours,
    }
