import logging
from typing import Any
from uuid import UUID

from app.database import get_connection, get_transaction

logger = logging.getLogger(__name__)

# Kept as plain strings (not a DB enum/CHECK) — same convention as
# service_name/charge_name elsewhere in this schema, validated at the
# application layer only.
NEW_ORDER = "new_order"
ORDER_COMPLETED = "order_completed"
INVOICE_GENERATED = "invoice_generated"
WALLET_RECHARGED = "wallet_recharged"
WALLET_DEDUCTED = "wallet_deducted"
INSUFFICIENT_BALANCE = "insufficient_balance"
ESIGN_STATUS = "esign_status"
EKYC_RESULT = "ekyc_result"
ESTAMP_STATUS = "estamp_status"


def create_notification(
    *,
    organization_id: UUID,
    order_id: UUID | None,
    notification_type: str,
    title: str,
    message: str | None = None,
    audience: str = "partner",
    organization_user_id: UUID | None = None,
) -> None:
    """Writes one notification row — unless an identical one (same order,
    type, message, and audience) already exists, in which case this is a
    no-op. Needed because the callers of this function are only best-effort
    idempotent themselves (e.g. esign_service._auto_generate_invoice_on_
    completion re-checks orders.status == 'Completed' before calling
    notify_order_completed, but a retried SignDesk webhook or a repeated
    admin action both still see that same 'Completed' state and would
    otherwise re-fire it every time). Scoped to (order_id, type, message)
    rather than just (order_id, type) so eStamp Bulk's two distinct
    "Invoice Generated" notifications — one per invoice, different invoice
    numbers in the message — both still get through; only a byte-identical
    repeat is treated as a duplicate. Never raises — a notification failing
    to write must never roll back or block the order/invoice action that
    triggered it, same reasoning as esign_service._auto_generate_invoice_on_
    completion's try/except wrapping. Callers should call this after their
    own transaction has already committed, not from inside it.

    organization_user_id: who within the org this row is specifically about
    (see the notification table comment in schema.sql) — NULL for a
    partner-org-level event (e.g. a Super Admin wallet recharge), set to a
    Partner User's organization_users.id for that user's own activity so
    both they and the partner-owner login see it (see
    app/routes/notifications.py's _member_scope_clause)."""
    try:
        with get_transaction() as connection:
            if order_id is not None:
                existing = connection.execute(
                    "SELECT 1 FROM notification WHERE order_id = %s AND type = %s AND message = %s AND audience = %s LIMIT 1",
                    (order_id, notification_type, message, audience),
                ).fetchone()
                if existing:
                    return
            connection.execute(
                """
                INSERT INTO notification (organization_id, order_id, type, title, message, audience, organization_user_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (organization_id, order_id, notification_type, title, message, audience, organization_user_id),
            )
    except Exception:
        logger.exception("Failed to create %s notification for order %s", notification_type, order_id)


def notify_new_order(order: dict[str, Any]) -> None:
    """order is any of the dicts returned by _create_order/create_bulk_estamp_
    order/create_manual_estamp_order's RETURNING clause — all three carry the
    same organization_id/id/order_no/service_name/organization_user_id
    fields. Writes two rows: one the ordering partner (and, if it was placed
    for a specific Partner User, that user too) sees in their own bell, one
    Super Admin/Admin Portal sees in theirs (see the audience column comment
    in schema.sql) — admins don't have an organization_id of their own to
    scope by, so their row names the ordering org in the message instead."""
    create_notification(
        organization_id=order["organization_id"],
        order_id=order["id"],
        notification_type=NEW_ORDER,
        title="New Order",
        message=f"Order {order['order_no']} ({order['service_name']}) was placed.",
        audience="partner",
        organization_user_id=order.get("organization_user_id"),
    )
    create_notification(
        organization_id=order["organization_id"],
        order_id=order["id"],
        notification_type=NEW_ORDER,
        title="New Order",
        message=f"{_organization_name(order['organization_id'])} placed order {order['order_no']} ({order['service_name']}).",
        audience="admin",
    )


def _organization_name(organization_id: UUID) -> str:
    try:
        with get_connection() as connection:
            org = connection.execute(
                "SELECT organization_name FROM organizations WHERE id = %s",
                (organization_id,),
            ).fetchone()
        return org["organization_name"] if org else "A partner"
    except Exception:
        logger.exception("Failed to look up organization_name for %s", organization_id)
        return "A partner"


def notify_order_completed(
    *, organization_id: UUID, order_id: UUID, order_no: str, service_name: str,
    organization_user_id: UUID | None = None,
) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=order_id,
        notification_type=ORDER_COMPLETED,
        title="Order Completed",
        message=f"Order {order_no} ({service_name}) has been completed.",
        organization_user_id=organization_user_id,
    )


def notify_invoice_generated(
    *, organization_id: UUID, order_id: UUID, order_no: str, invoice_number: str,
    organization_user_id: UUID | None = None,
) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=order_id,
        notification_type=INVOICE_GENERATED,
        title="Invoice Generated",
        message=f"Invoice {invoice_number} has been generated for order {order_no}.",
        organization_user_id=organization_user_id,
    )


def notify_wallet_recharged(*, organization_id: UUID, organization_user_id: UUID | None, amount: float) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=None,
        notification_type=WALLET_RECHARGED,
        title="Wallet Recharged",
        message=f"₹{amount:,.2f} was added to the wallet by Super Admin.",
        organization_user_id=organization_user_id,
    )


def notify_wallet_deducted(*, organization_id: UUID, organization_user_id: UUID | None, amount: float, description: str) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=None,
        notification_type=WALLET_DEDUCTED,
        title="Wallet Deduction",
        message=f"₹{amount:,.2f} was deducted — {description}.",
        organization_user_id=organization_user_id,
    )


def notify_insufficient_balance(*, organization_id: UUID, organization_user_id: UUID | None, amount: float, available: float) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=None,
        notification_type=INSUFFICIENT_BALANCE,
        title="Insufficient Wallet Balance",
        message=f"This action costs ₹{amount:,.2f} but only ₹{available:,.2f} is available in the wallet.",
        organization_user_id=organization_user_id,
    )


def notify_esign_status(
    *, organization_id: UUID, organization_user_id: UUID | None, order_id: UUID, order_no: str, status: str,
) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=order_id,
        notification_type=ESIGN_STATUS,
        title="eSign Status",
        message=f"eSign for order {order_no} was {status}.",
        organization_user_id=organization_user_id,
    )


def notify_ekyc_result(
    *, organization_id: UUID, organization_user_id: UUID | None, order_id: UUID, order_no: str, status: str,
) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=order_id,
        notification_type=EKYC_RESULT,
        title="eKYC Result",
        message=f"eKYC for order {order_no}: {status}.",
        organization_user_id=organization_user_id,
    )


def notify_estamp_status(
    *, organization_id: UUID, organization_user_id: UUID | None, order_id: UUID, order_no: str, status: str,
) -> None:
    create_notification(
        organization_id=organization_id,
        order_id=order_id,
        notification_type=ESTAMP_STATUS,
        title="eStamp Status",
        message=f"eStamp for order {order_no}: {status}.",
        organization_user_id=organization_user_id,
    )
