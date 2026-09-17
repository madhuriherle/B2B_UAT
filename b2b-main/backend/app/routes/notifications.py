from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth import get_current_partner_or_member
from app.database import get_connection, get_transaction

router = APIRouter()

# Separate router for Super Admin/Admin Portal — registered under
# /api/admin/notifications with dependencies=admin_only in main.py, so every
# endpoint here is already gated by get_current_admin before it runs.
admin_router = APIRouter()


def _member_scope_clause(current: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """A Partner Panel login (role='partner') manages the whole org, so it
    keeps seeing every notification for it — the pre-existing behavior.
    A Partner User (role='member', organization_user_id set) is scoped down
    to only notifications about THEM, via the notification row's own
    organization_user_id column (see the notification table comment in
    schema.sql) — set directly by whichever notify_* call created the row,
    so this works for wallet/eSign/eKYC/eStamp events with no order_id too,
    not just order-tied ones. organization_user_id IS NULL is let through
    for both, since that's a partner-org-level event (e.g. a Super Admin
    wallet recharge), not another member's activity."""
    organization_user_id = current.get("organization_user_id")
    if organization_user_id is None:
        return "", {}
    return (
        "AND (n.organization_user_id IS NULL OR n.organization_user_id = %(organization_user_id)s)",
        {"organization_user_id": organization_user_id},
    )


@router.get("")
def list_my_notifications(
    limit: int = 20, current=Depends(get_current_partner_or_member)
) -> dict[str, Any]:
    """Scoped to the organization (see notification table comment in
    schema.sql), further narrowed to the caller's own activity for a Partner
    User login (see _member_scope_clause) — a Partner Panel login still sees
    every notification across the org, since they manage all of it. Filtered
    to audience='partner' — 'admin' rows share the same organization_id but
    belong to the /api/admin/notifications feed below instead."""
    limit = max(1, min(limit, 100))
    scope_sql, scope_params = _member_scope_clause(current)
    params = {"organization_id": current["organization_id"], "limit": limit, **scope_params}
    with get_connection() as connection:
        unread_count = connection.execute(
            f"""
            SELECT COUNT(*) AS n
            FROM notification n
            WHERE n.organization_id = %(organization_id)s AND n.audience = 'partner' AND n.is_read = false
            {scope_sql}
            """,
            params,
        ).fetchone()["n"]
        items = connection.execute(
            f"""
            SELECT n.id, n.order_id, n.type, n.title, n.message, n.is_read, n.created_at
            FROM notification n
            WHERE n.organization_id = %(organization_id)s AND n.audience = 'partner'
            {scope_sql}
            ORDER BY n.created_at DESC
            LIMIT %(limit)s
            """,
            params,
        ).fetchall()
    return {"unread_count": unread_count, "items": items}


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID, current=Depends(get_current_partner_or_member)
) -> dict[str, Any]:
    scope_sql, scope_params = _member_scope_clause(current)
    params = {"notification_id": notification_id, "organization_id": current["organization_id"], **scope_params}
    with get_transaction() as connection:
        connection.execute(
            f"""
            UPDATE notification SET is_read = true
            WHERE id IN (
                SELECT n.id FROM notification n
                WHERE n.id = %(notification_id)s AND n.organization_id = %(organization_id)s AND n.audience = 'partner'
                {scope_sql}
            )
            """,
            params,
        )
    return {"status": "ok"}


@router.post("/read-all")
def mark_all_notifications_read(current=Depends(get_current_partner_or_member)) -> dict[str, Any]:
    scope_sql, scope_params = _member_scope_clause(current)
    params = {"organization_id": current["organization_id"], **scope_params}
    with get_transaction() as connection:
        connection.execute(
            f"""
            UPDATE notification SET is_read = true
            WHERE id IN (
                SELECT n.id FROM notification n
                WHERE n.organization_id = %(organization_id)s AND n.audience = 'partner' AND n.is_read = false
                {scope_sql}
            )
            """,
            params,
        )
    return {"status": "ok"}


@admin_router.get("")
def list_admin_notifications(limit: int = 20) -> dict[str, Any]:
    """Global feed shared by every Super Admin/Admin Portal login — admins
    have no organization_id of their own to scope by (see the audience
    column comment in schema.sql), so unlike the partner feed above this is
    not filtered per-user."""
    limit = max(1, min(limit, 100))
    with get_connection() as connection:
        unread_count = connection.execute(
            "SELECT COUNT(*) AS n FROM notification WHERE audience = 'admin' AND is_read = false",
        ).fetchone()["n"]
        items = connection.execute(
            """
            SELECT id, order_id, type, title, message, is_read, created_at
            FROM notification
            WHERE audience = 'admin'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
    return {"unread_count": unread_count, "items": items}


@admin_router.post("/{notification_id}/read")
def mark_admin_notification_read(notification_id: UUID) -> dict[str, Any]:
    with get_transaction() as connection:
        connection.execute(
            "UPDATE notification SET is_read = true WHERE id = %s AND audience = 'admin'",
            (notification_id,),
        )
    return {"status": "ok"}


@admin_router.post("/read-all")
def mark_all_admin_notifications_read() -> dict[str, Any]:
    with get_transaction() as connection:
        connection.execute(
            "UPDATE notification SET is_read = true WHERE audience = 'admin' AND is_read = false",
        )
    return {"status": "ok"}
