import base64
import logging
import os
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from psycopg.types.json import Jsonb

from app.database import get_connection, get_transaction
from app.email_service import send_esign_invitation_email, send_esign_link_outdated_email
from app.notification_service import notify_esign_status
from app.signdesk_esign import (
    SignDeskError,
    cancel_docket,
    new_document_reference_id,
    new_reference_id,
    new_signer_ref_id,
    resend_invitation,
    send_sign_request,
)
from app.validators import is_valid_pdf_bytes, validate_indian_mobile

logger = logging.getLogger(__name__)

ORDER_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "orders"
SIGNED_UPLOAD_DIR = ORDER_UPLOAD_DIR / "signed"

# Back-compat alias — stamp_service and older call sites import this name.
_is_valid_pdf_bytes = is_valid_pdf_bytes
PDF_MAGIC = b"%PDF-"


# Maps a SignDesk callback's `status` to our signer status vocabulary —
# anything not listed here (including the normal "success"/whatever SignDesk
# sends on completion) is treated as a successful signature.
STATUS_MAP = {
    "failed": "failed",
    "cancelled": "failed",
    "declined": "rejected",
    "rejected": "rejected",
    "expired": "expired",
}


SIGNATURE_POSITIONS = {"top-left", "top-right", "bottom-left", "bottom-right"}


class SignerIn(BaseModel):
    name: str
    # Optional — a signer with no email gets Melento SMS only. Signers with
    # an email also get LegalDesk's branded invitation email (see
    # email_service.send_esign_invitation_email); Melento invitation emails
    # are deliberately not used (they show "via Melento" + Melento logo).
    email: EmailStr | None = None
    mobile: str
    # Where on the page this signer's signature appears. Optional — if the
    # client leaves it unset, send_sign_request falls back to auto-cycling
    # through the four corners by signer sequence (its prior behavior).
    position: str | None = None

    _validate_mobile = field_validator("mobile")(validate_indian_mobile)

    @field_validator("position", mode="before")
    @classmethod
    def _validate_position(cls, value: str | None) -> str | None:
        if not value:
            return None
        if value not in SIGNATURE_POSITIONS:
            raise ValueError(f"position must be one of {sorted(SIGNATURE_POSITIONS)}")
        return value


def _get_order_for_esign(connection, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    order = connection.execute(
        """
        SELECT
            o.id, o.order_no, o.organization_user_id, o.service_name,
            o.document_filename, o.document_path, o.esign_price_per_signer,
            COALESCE(NULLIF(u.full_name, ''), NULLIF(org.organization_name, ''), 'LegalDesk') AS inviter_name,
            u.email AS inviter_email
        FROM orders o
        LEFT JOIN organization_users ou ON ou.id = o.organization_user_id
        LEFT JOIN users u ON u.id = ou.user_id
        LEFT JOIN organizations org ON org.id = o.organization_id
        WHERE o.id = %s AND o.organization_id = %s
        """,
        (order_id, organization_id),
    ).fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    # eStamp orders may also be sent for eSign afterwards (see
    # _get_esign_source_pdf, which signs the stamped copy in that case) —
    # the create-order form offers this as an opt-in follow-up step. Manual
    # eStamp orders with esign_required go through the same path, driven by
    # Super Admin's "Send for eSign" action instead of a partner-facing form
    # (see partner.send_manual_estamp_for_esign).
    if order["service_name"] not in ("eSign", "eStamp", "Manual eStamp"):
        raise HTTPException(status_code=400, detail="This order cannot be sent for eSign")
    if not order["document_path"]:
        raise HTTPException(status_code=400, detail="Order has no document to send for signature")
    return order


def _send_legaldesk_invitation_emails(
    *,
    signers: list[dict[str, Any]],
    inviter_name: str,
    inviter_email: str | None,
    document_name: str,
) -> None:
    """Best-effort LegalDesk-branded invitation emails. Never raises — a
    failed invite email must not roll back an already-created SignDesk
    docket / DB rows."""
    for signer in signers:
        email = (signer.get("signer_email") or signer.get("email") or "").strip()
        link = (signer.get("invitation_link") or "").strip()
        if not email or not link:
            continue
        try:
            send_esign_invitation_email(
                to_email=email,
                signer_name=signer.get("signer_name") or signer.get("name") or "",
                inviter_name=inviter_name or "LegalDesk",
                document_name=document_name,
                invitation_link=link,
                reply_to=inviter_email or None,
            )
        except Exception:
            logger.exception(
                "Failed to send LegalDesk eSign invitation email to %s for document %s",
                email, document_name,
            )


def _get_esign_source_pdf(connection, order: dict[str, Any]) -> bytes:
    """The actual document sent for signature. An eStamp order signs the
    stamped copy (with SignDesk's stamp paper attached — see
    stamp_service.initiate_stamp) rather than the bare upload, and can only
    do so once that stamp has completed. A Manual eStamp order signs the
    copy Super Admin manually uploaded (see
    partner.upload_manual_estamp_stamped_document) instead — no SignDesk
    stamp API involved for this service at all."""
    if order["service_name"] == "eStamp":
        from app.stamp_service import STAMPED_UPLOAD_DIR  # local import avoids a module-level circular import

        stamp = connection.execute(
            "SELECT status, stamped_file_path FROM b2b_stamp_transaction WHERE order_id = %s",
            (order["id"],),
        ).fetchone()
        if not stamp or stamp["status"] != "completed" or not stamp["stamped_file_path"]:
            raise HTTPException(status_code=400, detail="The eStamp request must complete before this document can be sent for eSign")
        path = STAMPED_UPLOAD_DIR / stamp["stamped_file_path"]
        if not path.exists():
            raise HTTPException(status_code=404, detail="Stamped document file is missing on the server")
        return path.read_bytes()

    if order["service_name"] == "Manual eStamp":
        from app.stamp_service import STAMPED_UPLOAD_DIR  # same upload dir reused for both services' stamped copies

        manual = connection.execute(
            "SELECT stamped_document_path FROM b2b_manual_estamp_order WHERE order_id = %s",
            (order["id"],),
        ).fetchone()
        if not manual or not manual["stamped_document_path"]:
            raise HTTPException(status_code=400, detail="The stamped document must be uploaded before this order can be sent for eSign")
        path = STAMPED_UPLOAD_DIR / manual["stamped_document_path"]
        if not path.exists():
            raise HTTPException(status_code=404, detail="Stamped document file is missing on the server")
        return path.read_bytes()

    path = ORDER_UPLOAD_DIR / order["document_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Uploaded document not found on server")
    return path.read_bytes()


def _cancel_transaction(*, transaction_id: UUID, docket_id: str | None, document_id: str | None, reason: str) -> None:
    """Shared by initiate_esign (superseding via edit) and
    cancel_esign_workflow (explicit user cancellation) — best-effort tells
    SignDesk to cancel the docket (never blocks; see cancel_docket's
    docstring), marks our copy inactive so record_callback rejects any
    callback still tied to it, and flips any signer who hasn't reached a
    terminal state to 'cancelled' so the timeline never shows a stale
    "Pending" for a link that no longer works.

    Also releases whatever's left of this order's esign_wallet_blocked_amount
    — by construction that figure is always exactly the not-yet-signed
    signers' reserved share (each signed signer's share was already peeled
    off individually as they signed — see partner._convert_partial_block_to_
    debit), so releasing "everything remaining" here is correct whether zero,
    some, or all signers had already finished before this cancellation."""
    if docket_id:
        try:
            cancel_docket(docket_id=docket_id, document_id=document_id)
        except Exception:
            logger.exception("cancel_docket raised unexpectedly for docket %s", docket_id)
    with get_transaction() as connection:
        connection.execute(
            """
            UPDATE b2b_esign_transaction
            SET is_active = false, status = 'cancelled', cancelled_at = now(),
                cancellation_reason = %s, updated_at = now()
            WHERE id = %s
            """,
            (reason, transaction_id),
        )
        connection.execute(
            """
            UPDATE b2b_esign_signer SET status = 'cancelled', updated_at = now()
            WHERE transaction_id = %s AND status IN ('pending', 'sent')
            """,
            (transaction_id,),
        )

        order_block = connection.execute(
            """
            SELECT o.id, o.organization_id, o.organization_user_id, o.esign_wallet_blocked_amount
            FROM b2b_esign_signer s
            JOIN orders o ON o.id = s.order_id
            WHERE s.transaction_id = %s
            LIMIT 1
            """,
            (transaction_id,),
        ).fetchone()
        if order_block and float(order_block["esign_wallet_blocked_amount"]) > 0:
            from app.routes.partner import _release_wallet_block  # local import avoids a module-level circular import

            _release_wallet_block(
                connection,
                organization_id=order_block["organization_id"], organization_user_id=order_block["organization_user_id"],
                amount=float(order_block["esign_wallet_blocked_amount"]), order_id=order_block["id"],
                order_column="esign_wallet_blocked_amount",
            )


def cancel_esign_workflow(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    """Explicit "Cancel Workflow" action — stops the signing process outright
    (as opposed to initiate_esign's supersede-with-a-new-version behavior).
    Already-signed signers keep their signed/billed status; any signer still
    pending is marked 'cancelled' and their link can no longer complete or
    affect billing (see record_callback's active-workflow check)."""
    with get_connection() as connection:
        _get_order_for_esign(connection, order_id, organization_id)
        active = connection.execute(
            "SELECT id, status, docket_id, document_id FROM b2b_esign_transaction WHERE order_id = %s AND is_active = true",
            (order_id,),
        ).fetchone()
    if not active:
        raise HTTPException(status_code=404, detail="No active eSign workflow to cancel")
    if active["status"] != "sent":
        raise HTTPException(status_code=400, detail="This workflow has already reached a final state and cannot be cancelled")

    _cancel_transaction(
        transaction_id=active["id"], docket_id=active["docket_id"], document_id=active["document_id"],
        reason="Cancelled by user",
    )
    return {"status": "cancelled"}


def resend_signer_invitation(*, order_id: UUID, signer_id: UUID, organization_id: UUID) -> dict[str, Any]:
    """"Resend Email" action for a single pending signer — does not create a
    new workflow version, just re-notifies within the current active docket."""
    with get_connection() as connection:
        order = _get_order_for_esign(connection, order_id, organization_id)
        signer = connection.execute(
            """
            SELECT
                s.id, s.status, s.signer_name, s.signer_email, s.invitation_link,
                s.signdesk_signer_id, s.signdesk_document_id, t.is_active, t.docket_id
            FROM b2b_esign_signer s
            JOIN b2b_esign_transaction t ON t.id = s.transaction_id
            WHERE s.id = %s AND s.order_id = %s
            """,
            (signer_id, order_id),
        ).fetchone()
    if not signer:
        raise HTTPException(status_code=404, detail="Signer not found")
    if not signer["is_active"]:
        raise HTTPException(status_code=400, detail="This signer belongs to a workflow that is no longer active")
    if signer["status"] not in ("pending", "sent"):
        raise HTTPException(status_code=400, detail="Only pending signers can be sent a reminder")

    document_name = f"eSign - {order['document_filename'] or order_id}"
    legaldesk_notified = False
    if signer.get("signer_email") and signer.get("invitation_link"):
        try:
            send_esign_invitation_email(
                to_email=signer["signer_email"],
                signer_name=signer["signer_name"] or "",
                inviter_name=order.get("inviter_name") or "LegalDesk",
                document_name=document_name,
                invitation_link=signer["invitation_link"],
                reply_to=order.get("inviter_email") or None,
            )
            legaldesk_notified = True
        except Exception:
            logger.exception(
                "Failed to resend LegalDesk eSign invitation email to %s",
                signer.get("signer_email"),
            )

    # Melento's Resend Invitation API re-sends Melento-branded email. Only
    # call it for SMS-only signers (no email), where Melento SMS is the
    # delivery channel.
    provider_notified = False
    if not signer.get("signer_email"):
        provider_notified = resend_invitation(
            document_id=signer["signdesk_document_id"],
            docket_id=signer["docket_id"],
            signer_id=signer["signdesk_signer_id"],
        )

    with get_transaction() as connection:
        connection.execute(
            "UPDATE b2b_esign_signer SET last_reminder_sent_at = now(), updated_at = now() WHERE id = %s",
            (signer_id,),
        )
    return {
        "status": "reminder_logged",
        "provider_notified": provider_notified,
        "legaldesk_notified": legaldesk_notified,
    }


def initiate_esign(*, order_id: UUID, organization_id: UUID, signers: list[SignerIn]) -> dict[str, Any]:
    """Sends the document for signature. Called both for the first send and
    for a re-send after editing signer details — in the latter case, the
    current active workflow (if nobody has signed yet) is cancelled and
    superseded by a brand new one (new version, new SignDesk docket) rather
    than mutated in place, so history is preserved and an old docket's
    webhook callbacks can be told apart from the current one (see
    record_callback's active-workflow check)."""
    if not signers:
        raise HTTPException(status_code=400, detail="At least one signer is required")

    # SignerIn.email is optional — Melento always triggers via SMS (so it
    # never sends its Melento-branded email). Signers with an email also get
    # LegalDesk's invitation email after SignDesk returns invitation_link.
    # Every signer's mobile is already validated/mandatory, so there's
    # always at least one delivery channel.

    chosen_positions = [s.position for s in signers if s.position]
    if len(chosen_positions) != len(set(chosen_positions)):
        raise HTTPException(status_code=400, detail="Each signer must have a distinct signature position")

    with get_connection() as connection:
        order = _get_order_for_esign(connection, order_id, organization_id)
        active = connection.execute(
            "SELECT id, version, docket_id, document_id FROM b2b_esign_transaction WHERE order_id = %s AND is_active = true",
            (order_id,),
        ).fetchone()

        # eStamp orders have no eSign price of their own (they were billed as
        # eStamp at creation) — look up the org's current eSign price here so
        # the per-signature wallet debit in _apply_signer_status has
        # something correct to charge, same as a native eSign order does at
        # creation time.
        stamp_esign_price_per_signer: float | None = None
        if order["service_name"] == "eStamp":
            esign_pricing = connection.execute(
                "SELECT is_active, price FROM organization_service_pricing WHERE organization_id = %s AND service_name = 'eSign'",
                (organization_id,),
            ).fetchone()
            if not esign_pricing or not esign_pricing["is_active"]:
                raise HTTPException(status_code=400, detail="eSign is not enabled for your account. Contact Super Admin.")
            stamp_esign_price_per_signer = float(esign_pricing["price"] or 0)

        pdf_bytes = _get_esign_source_pdf(connection, order)

    if active:
        # Editing/resending: supersede the current workflow rather than
        # mutating it.
        _cancel_transaction(
            transaction_id=active["id"], docket_id=active["docket_id"], document_id=active["document_id"],
            reason="Signer details updated",
        )

    version = (active["version"] if active else 0) + 1

    # Reserve the full workflow cost — price_per_signer x every signer on
    # THIS send — before ever dispatching invitations, same "never commit to
    # something we can't pay for" principle as eStamp's own block-at-
    # creation. effective_price_per_signer is either the eStamp-attach case's
    # freshly-resolved price above, or a plain/Manual eStamp eSign order's
    # own price already stored on the order at creation time. Uses its own
    # esign_wallet_blocked_amount column — kept completely independent of
    # wallet_blocked_amount (the stamp-duty block a combo order may ALSO be
    # carrying) — see partner._block_wallet_amount's order_column param.
    # Raises the same insufficient-balance error _block_wallet_amount always
    # does, before SignDesk is ever called, if the org can't cover it.
    from app.routes.partner import _block_wallet_amount, _release_wallet_block  # local import avoids a module-level circular import

    effective_price_per_signer = (
        stamp_esign_price_per_signer if stamp_esign_price_per_signer is not None else float(order["esign_price_per_signer"] or 0)
    )
    total_block = effective_price_per_signer * len(signers)
    with get_transaction() as connection:
        _block_wallet_amount(
            connection,
            organization_id=organization_id, organization_user_id=order["organization_user_id"],
            amount=total_block, order_id=order_id, order_column="esign_wallet_blocked_amount",
            description=f"Order {order['order_no']} · eSign · {len(signers)} signer(s) (blocked)",
        )

    order_id_str = str(order_id)
    reference_id = new_reference_id(order_id_str)
    # Derived from reference_id (unique per version), not the bare order_id,
    # so a re-send never sends SignDesk the same reference_doc_id/ref_id a
    # previous version already used.
    document_reference_id = new_document_reference_id(reference_id)
    signdesk_signers = [
        {
            "ref_id": new_signer_ref_id(reference_id, i),
            "name": signer.name,
            # Normalized to "" (not None) here — b2b_esign_signer.signer_email
            # is NOT NULL, and this same dict is inserted into that column
            # below as well as sent to SignDesk (send_sign_request does its
            # own "or ''" too, but that only covers the outgoing API payload,
            # not this DB insert).
            "email": signer.email or "",
            "mobile": signer.mobile,
            "sequence": i + 1,
            "position": signer.position,
        }
        for i, signer in enumerate(signers)
    ]

    try:
        response = send_sign_request(
            reference_id=reference_id,
            docket_title=f"eSign - {order['document_filename'] or order_id_str}",
            pdf_bytes=pdf_bytes,
            document_reference_id=document_reference_id,
            signers=signdesk_signers,
        )
        # SignDesk reports its own success/failure inside a 200 OK body (only
        # transport/HTTP errors raise SignDeskError above) — a logical
        # failure here must be treated the same as one, or it gets recorded
        # as status='sent' below despite SignDesk never actually sending it.
        if response.get("status") != "success":
            raise SignDeskError(response.get("error") or f"SignDesk request failed: {response}")
    except SignDeskError as e:
        with get_transaction() as connection:
            # The send itself failed — nothing was reserved for anything
            # real, so release the block made just above rather than leave
            # it stuck against this order forever.
            if total_block > 0:
                _release_wallet_block(
                    connection,
                    organization_id=organization_id, organization_user_id=order["organization_user_id"],
                    amount=total_block, order_id=order_id, order_column="esign_wallet_blocked_amount",
                )
            connection.execute(
                """
                INSERT INTO b2b_esign_transaction (order_id, reference_id, version, is_active, status, raw_response, updated_at)
                VALUES (%s, %s, %s, true, 'failed', %s, now())
                """,
                (order_id, reference_id, version, Jsonb({"error": str(e)})),
            )
            # Only for a native eSign order — never for an eStamp order that
            # merely had eSign attached afterward (this same code path,
            # service_name stays "eStamp" for that case): the stamp itself
            # may have already genuinely completed, and this send failing
            # doesn't erase that. For a plain eSign order, though, nothing
            # else about it ever succeeds, so without this orders.status
            # stays wherever creation left it (e.g. "Submitted") forever —
            # Order Reports' Pending/Processing/Completed relabel
            # (list_order_reports) then shows a permanently dead order as
            # "Pending", implying it's still awaiting action, and Order
            # Detail keeps offering "Generate Invoice" for something that
            # can never be invoiced. Same reasoning as stamp_service.
            # initiate_stamp's identical fix for single eStamp.
            if order["service_name"] == "eSign":
                connection.execute(
                    "UPDATE orders SET status = 'Failed', updated_at = now() WHERE id = %s",
                    (order_id,),
                )
        raise HTTPException(status_code=502, detail=str(e)) from e

    docket_id = response.get("docket_id")
    document_id = response.get("document_id")
    signer_info_by_ref = {
        info.get("signer_ref_id"): info for info in response.get("signer_info", []) if isinstance(info, dict)
    }

    with get_transaction() as connection:
        if stamp_esign_price_per_signer is not None:
            # Only set once — a resend must not silently reprice an
            # already-billed workflow if the org's eSign price changes
            # in between.
            connection.execute(
                "UPDATE orders SET esign_price_per_signer = COALESCE(esign_price_per_signer, %s) WHERE id = %s",
                (stamp_esign_price_per_signer, order_id),
            )
            # stamp_service.initiate_stamp optimistically marks a plain
            # eStamp order 'Completed' the instant the stamp itself finishes,
            # assuming no eSign will follow. If eSign is being requested on
            # top of it right here (this whole branch only runs for
            # service_name == 'eStamp' — see stamp_esign_price_per_signer
            # above), that assumption just turned out wrong — downgrade back
            # to 'Partially Completed' so it doesn't look done while eSign is
            # still in flight. The rollup in _apply_signer_status re-completes
            # it once eSign actually finishes signing.
            connection.execute(
                "UPDATE orders SET status = 'Partially Completed', updated_at = now() WHERE id = %s AND status = 'Completed'",
                (order_id,),
            )
        transaction = connection.execute(
            """
            INSERT INTO b2b_esign_transaction (order_id, reference_id, version, is_active, docket_id, document_id, status, raw_response, updated_at)
            VALUES (%s, %s, %s, true, %s, %s, 'sent', %s, now())
            RETURNING id
            """,
            (order_id, reference_id, version, docket_id, document_id, Jsonb(response)),
        ).fetchone()

        result_signers = []
        for signer in signdesk_signers:
            info = signer_info_by_ref.get(signer["ref_id"], {})
            row = connection.execute(
                """
                INSERT INTO b2b_esign_signer (
                    order_id, transaction_id, signer_name, signer_email, signer_mobile, status, sequence,
                    signdesk_signer_ref_id, signdesk_signer_id, signdesk_document_id, invitation_link, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, 'sent', %s, %s, %s, %s, %s, now())
                RETURNING id, signer_name, signer_email, signer_mobile, status, invitation_link
                """,
                (
                    order_id, transaction["id"], signer["name"], signer["email"], signer["mobile"], signer["sequence"],
                    signer["ref_id"], info.get("signer_id"), info.get("document_id"), info.get("invitation_link"),
                ),
            ).fetchone()
            result_signers.append(row)

    _send_legaldesk_invitation_emails(
        signers=result_signers,
        inviter_name=order.get("inviter_name") or "LegalDesk",
        inviter_email=order.get("inviter_email"),
        document_name=f"eSign - {order['document_filename'] or order_id_str}",
    )

    return {"status": "sent", "version": version, "docket_id": docket_id, "document_id": document_id, "signers": result_signers}


def get_esign_status(*, order_id: UUID, organization_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        _get_order_for_esign(connection, order_id, organization_id)
        transaction = connection.execute(
            """
            SELECT id, version, status, docket_id, document_id, signed_file_path, created_at, updated_at
            FROM b2b_esign_transaction WHERE order_id = %s AND is_active = true
            """,
            (order_id,),
        ).fetchone()
        if not transaction:
            raise HTTPException(status_code=404, detail="No eSign request has been sent for this order yet")
        signers = connection.execute(
            """
            SELECT id, signer_name, signer_email, signer_mobile, status, invitation_link, signed_at
            FROM b2b_esign_signer WHERE transaction_id = %s ORDER BY created_at ASC
            """,
            (transaction["id"],),
        ).fetchall()

    return {**transaction, "signers": signers}


def _save_signed_pdf(*, order_id: UUID, content_b64: str) -> str | None:
    """Persists the signed PDF SignDesk includes directly in the completion
    webhook (never a separate download call — the callback payload already
    has it). Never raises: a bad/corrupted payload must not roll back the
    signer status update or wallet debit happening alongside it in
    record_callback, so every failure here is caught, logged, and reported
    back as None (meaning "storage failed, leave signed_file_path as-is") —
    the original uploaded document (stored separately, untouched) remains
    available as a fallback either way.

    Writes to a temp file first and atomically renames into place, so a
    crash or full disk mid-write can never leave a half-written, corrupted
    file sitting at the final path.
    """
    logger.info("Signed PDF content received in eSign webhook for order %s (%d base64 chars).", order_id, len(content_b64))

    try:
        pdf_bytes = base64.b64decode(content_b64, validate=True)
    except Exception:
        logger.error("eSign webhook for order %s included unparseable base64 PDF content — discarding.", order_id)
        return None

    if not _is_valid_pdf_bytes(pdf_bytes):
        logger.error(
            "eSign webhook for order %s included content that doesn't look like a valid PDF "
            "(got %d bytes, missing %%PDF- header) — discarding.",
            order_id, len(pdf_bytes),
        )
        return None

    try:
        SIGNED_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{order_id}.pdf"
        final_path = SIGNED_UPLOAD_DIR / filename
        tmp_path = SIGNED_UPLOAD_DIR / f".{filename}.{uuid4().hex[:8]}.tmp"
        tmp_path.write_bytes(pdf_bytes)
        os.replace(tmp_path, final_path)
    except OSError:
        logger.exception("Failed to write signed PDF to disk for order %s", order_id)
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        return None

    logger.info("Stored signed PDF for order %s (%d bytes) at %s", order_id, len(pdf_bytes), final_path)
    return filename


def get_signed_file_path(*, order_id: UUID, organization_id: UUID) -> Path:
    with get_connection() as connection:
        _get_order_for_esign(connection, order_id, organization_id)
        transaction = connection.execute(
            "SELECT signed_file_path FROM b2b_esign_transaction WHERE order_id = %s AND is_active = true",
            (order_id,),
        ).fetchone()

    if not transaction or not transaction["signed_file_path"]:
        raise HTTPException(status_code=404, detail="Signed document is not available yet")

    path = SIGNED_UPLOAD_DIR / transaction["signed_file_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Signed document file is missing on server")

    # Defense in depth against on-disk corruption from any source (not just
    # the webhook write path above) — never serve a broken file, fall back
    # to the original document instead (see the frontend's signed-preview ->
    # preview fallback).
    try:
        with open(path, "rb") as f:
            header = f.read(5)
    except OSError:
        logger.exception("Failed to read signed PDF for order %s at %s", order_id, path)
        raise HTTPException(status_code=404, detail="Signed document could not be read")

    if not _is_valid_pdf_bytes(header):
        logger.error("Signed PDF for order %s at %s failed validation on read — treating as unavailable.", order_id, path)
        raise HTTPException(status_code=404, detail="Signed document appears to be corrupted")

    return path


def _resolve_signer_id_by_email(connection, *, document_id: str, email: str | None) -> str | None:
    """Fallback for the Completion Callback: its signer_info[] entries only
    ever carry {"name", "email", "mobile"} (confirmed against a real UAT
    payload, once SignDesk actually had a webhook URL configured to send
    it) — no signer_id, unlike the Individual Callback / return_url shapes.
    Without this, record_callback's loop below has nothing to match a
    signer on and silently skips the entry — dropping file_content along
    with it, since that only ever arrives on this exact shape."""
    if not email:
        return None
    row = connection.execute(
        "SELECT signdesk_signer_id FROM b2b_esign_signer WHERE signdesk_document_id = %s AND lower(signer_email) = lower(%s) LIMIT 1",
        (document_id, email),
    ).fetchone()
    return row["signdesk_signer_id"] if row else None


def _extract_signer_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalizes signer_info into a list of per-signer dicts. Per the
    documented webhook shape, SignDesk sends a single object for the
    Individual Callback (fired once per signer) or an array — one entry per
    signer in the docket — for the Completion Callback (fired once everyone
    is done). The legacy form-encoded return_url redirect (see
    routes/esign.py's _parse_callback_body) has no signer_info block at all
    and puts signer_id directly at the top level instead; that shape falls
    through to a single empty entry here, and _apply_signer_status falls back
    to the top-level payload fields for it."""
    signer_info = payload.get("signer_info")
    if isinstance(signer_info, dict):
        return [signer_info]
    if isinstance(signer_info, list):
        entries = [entry for entry in signer_info if isinstance(entry, dict)]
        if entries:
            return entries
    return [{}]


def _apply_signer_status(
    connection,
    *,
    document_id: str,
    signer_id: str,
    new_status: str,
    opened_at: Any,
    ip_address: Any,
    device_info: Any,
    payload: dict[str, Any],
    signed_content: str | None,
    saved_transactions: set,
) -> bool:
    """Applies one signer's status update within an already-open transaction.
    Called once for the Individual Callback, or once per signer_info[] entry
    for the Completion Callback (see record_callback). Returns whether
    (document_id, signer_id) matched a known signer — a miss is not an error,
    just silently ignored, same as an unmatched callback always has been.

    Converts exactly this ONE signer's share of the block placed at send
    time (see initiate_esign) into a real debit the moment they first reach
    'signed' — see partner._convert_partial_block_to_debit below. Other
    still-pending signers' shares are untouched, so the order's
    esign_wallet_blocked_amount only ever shrinks by one signer's worth at a
    time, reaching 0 once everyone has signed."""
    match = connection.execute(
        """
        SELECT s.id, s.order_id, s.transaction_id, s.status AS previous_status,
               s.signer_name, s.signer_email,
               t.is_active AS transaction_is_active,
               o.order_no, o.organization_id, o.organization_user_id, o.esign_price_per_signer
        FROM b2b_esign_signer s
        JOIN b2b_esign_transaction t ON t.id = s.transaction_id
        JOIN orders o ON o.id = s.order_id
        WHERE s.signdesk_document_id = %s AND s.signdesk_signer_id = %s
        FOR UPDATE OF s
        """,
        (document_id, signer_id),
    ).fetchone()
    if not match:
        return False

    # The payload is already logged (by record_callback) regardless — this
    # just makes sure a callback for a superseded workflow (e.g. someone
    # using a stale email link after signer details were edited) can never
    # touch status or billing. See initiate_esign for how a workflow becomes
    # inactive.
    if not match["transaction_is_active"]:
        # A genuine-looking "signed" completion on an old, superseded link is
        # exactly the confusing case worth telling the signer about:
        # SignDesk's hosted page has no idea we cancelled the workflow
        # internally, so they see a normal success screen there and would
        # otherwise never know it wasn't actually recorded. Best-effort
        # only — never let a notification failure affect the webhook
        # response back to SignDesk.
        if new_status == "signed":
            try:
                active_signer = connection.execute(
                    """
                    SELECT s2.invitation_link
                    FROM b2b_esign_signer s2
                    JOIN b2b_esign_transaction t2 ON t2.id = s2.transaction_id
                    WHERE t2.order_id = %s AND t2.is_active = true AND s2.signer_email = %s
                    LIMIT 1
                    """,
                    (match["order_id"], match["signer_email"]),
                ).fetchone()
                send_esign_link_outdated_email(
                    to_email=match["signer_email"],
                    to_name=match["signer_name"],
                    order_no=match["order_no"],
                    new_invitation_link=active_signer["invitation_link"] if active_signer else None,
                )
                logger.info(
                    "Notified %s that their signing link for order %s is outdated (workflow was superseded).",
                    match["signer_email"], match["order_no"],
                )
            except Exception:
                logger.exception(
                    "Failed to send 'outdated signing link' notification to %s for order %s",
                    match["signer_email"], match["order_no"],
                )
        return True

    connection.execute(
        """
        UPDATE b2b_esign_signer
        SET status = %s,
            signed_at = CASE WHEN %s = 'signed' AND status != 'signed' THEN now() ELSE signed_at END,
            opened_at = COALESCE(%s, opened_at),
            ip_address = COALESCE(%s, ip_address),
            device_info = COALESCE(%s, device_info),
            raw_callback_payload = %s,
            updated_at = now()
        WHERE id = %s
        """,
        (new_status, new_status, opened_at, ip_address, device_info, Jsonb(payload), match["id"]),
    )

    order_id = match["order_id"]

    # The exact moment this ONE signer's share becomes real money — only on
    # their first transition into 'signed' (never re-fires for a duplicate/
    # retried webhook: previous_status is read before the UPDATE above, so a
    # second callback for an already-'signed' row sees previous_status ==
    # 'signed' and skips this). Independent of every other signer's status —
    # deliberately NOT gated on the whole order reaching 'Completed'; see
    # initiate_esign for where the matching block was placed, and
    # _auto_generate_invoice_on_completion for the (now wallet-inert) final
    # invoice document once every signer's share has been converted this way.
    if new_status == "signed" and match["previous_status"] != "signed" and float(match["esign_price_per_signer"] or 0) > 0:
        from app.routes.partner import _convert_partial_block_to_debit  # local import avoids a module-level circular import

        _convert_partial_block_to_debit(
            connection,
            organization_id=match["organization_id"], organization_user_id=match["organization_user_id"],
            amount=float(match["esign_price_per_signer"]), order_id=order_id, order_column="esign_wallet_blocked_amount",
            description=f"Order {match['order_no']} · eSign · {match['signer_name']} signed",
        )

    # Best-available PDF snapshot: overwrite on ANY callback carrying
    # content, not just the one that completes every signer, so the
    # document preview reflects whatever signatures SignDesk has applied
    # so far (degrades gracefully if SignDesk only ever sends content on
    # the final callback). Never fetched via a separate download call —
    # SignDesk already includes it in the webhook payload. saved_transactions
    # dedupes redundant writes when the Completion Callback's signer_info[]
    # carries several signers from the same transaction in one request.
    transaction_id = match["transaction_id"]

    if signed_content and transaction_id not in saved_transactions:
        saved_transactions.add(transaction_id)
        signed_file_path = _save_signed_pdf(order_id=order_id, content_b64=signed_content)
        # None means storage failed (bad content or a disk error, already
        # logged in _save_signed_pdf) — leave the DB's signed_file_path
        # exactly as it was rather than pointing at nothing, so a prior
        # good snapshot (or the original document) stays the fallback.
        if signed_file_path:
            logger.info(
                "Associating signed PDF '%s' with order %s, workflow transaction %s.",
                signed_file_path, order_id, transaction_id,
            )
            connection.execute(
                "UPDATE b2b_esign_transaction SET signed_file_path = %s, updated_at = now() WHERE id = %s",
                (signed_file_path, transaction_id),
            )

    remaining = connection.execute(
        """
        SELECT COUNT(*) AS n FROM b2b_esign_signer
        WHERE transaction_id = %s AND status NOT IN ('signed', 'rejected', 'expired', 'failed', 'cancelled')
        """,
        (transaction_id,),
    ).fetchone()
    if remaining["n"] == 0:
        # Every signer has reached a terminal state — pick the overall
        # workflow outcome by priority so the Order List/Detail "Status"
        # can show one clear label (Rejected beats Expired beats Failed)
        # instead of a generic bucket.
        statuses_present = {
            row["status"]
            for row in connection.execute(
                "SELECT DISTINCT status FROM b2b_esign_signer WHERE transaction_id = %s AND status != 'signed'",
                (transaction_id,),
            ).fetchall()
        }
        if "rejected" in statuses_present:
            final_status = "rejected"
        elif "expired" in statuses_present:
            final_status = "expired"
        elif "failed" in statuses_present:
            final_status = "failed"
        else:
            final_status = "signed"
        connection.execute(
            "UPDATE b2b_esign_transaction SET status = %s, updated_at = now() WHERE id = %s",
            (final_status, transaction_id),
        )

        # A "signed" outcome is already reported via the order's own
        # Completed transition below (notify_order_completed, fired from
        # _auto_generate_invoice_on_completion) — that single notification
        # covers both "order status changed" and "eSign status" for the
        # happy path, so it isn't duplicated here. rejected/expired/failed
        # never move orders.status at all (see the comment below), so this
        # is the only notification those outcomes ever get.
        if final_status != "signed":
            notify_esign_status(
                organization_id=match["organization_id"], organization_user_id=match["organization_user_id"],
                order_id=order_id, order_no=match["order_no"], status=final_status.capitalize(),
            )

        # Manual eStamp's own richer status flow (see partner.py's
        # MANUAL_ESTAMP_STATUS_*) advances itself the moment every signer
        # finishes signing. Only advances on the happy path (every signer
        # actually signed); any other terminal outcome (rejected/expired/
        # failed) leaves the order sitting at "eSign Pending" for Super Admin
        # to handle manually — this function has no opinion on what a Manual
        # eStamp order should do next in that case.
        if final_status == "signed":
            connection.execute(
                """
                UPDATE orders SET status = 'eSign Completed', updated_at = now()
                WHERE id = (SELECT order_id FROM b2b_esign_transaction WHERE id = %s)
                  AND service_name = 'Manual eStamp' AND status = 'eSign Pending'
                """,
                (transaction_id,),
            )
            # Plain eSign orders: orders.status historically never reflected
            # the signing outcome at all (always stayed "Submitted"). Now
            # persisted here — the single source of truth
            # _auto_generate_invoice_on_completion and
            # invoice_service._resolve_order_invoice both gate on, matching
            # the same status-column pattern eStamp Bulk/Manual eStamp use
            # (see partner.update_bulk_estamp_order_status). The
            # `status != 'Completed'` guard makes this idempotent — a
            # duplicate/retried callback for an already-completed order
            # updates zero rows instead of re-triggering anything downstream.
            connection.execute(
                """
                UPDATE orders SET status = 'Completed', updated_at = now()
                WHERE id = (SELECT order_id FROM b2b_esign_transaction WHERE id = %s)
                  AND service_name = 'eSign' AND status != 'Completed'
                """,
                (transaction_id,),
            )

            # eStamp orders with eSign attached afterwards (see
            # stamp_service.initiate_stamp, which optimistically completes a
            # plain eStamp order the moment the stamp itself is done, then
            # initiate_esign below downgrades it back to 'Partially Completed'
            # the moment eSign gets requested on top of it) — only reaches
            # 'Completed' here once the stamp is ALSO actually done, so a
            # signed-before-stamped edge case (shouldn't happen given the
            # frontend only ever requests eSign after a completed stamp, but
            # cheap to guard against here) can't prematurely complete it.
            connection.execute(
                """
                UPDATE orders SET status = 'Completed', updated_at = now()
                WHERE id = (SELECT order_id FROM b2b_esign_transaction WHERE id = %s)
                  AND service_name = 'eStamp' AND status != 'Completed'
                  AND EXISTS (
                      SELECT 1 FROM b2b_stamp_transaction st
                      WHERE st.order_id = orders.id AND st.status = 'completed'
                  )
                """,
                (transaction_id,),
            )

    return True


def _auto_generate_invoice_on_completion(order_id: UUID, *, charge_wallet: bool = False) -> None:
    """The moment an eSign workflow finishes fully signed — i.e. the exact
    instant orders.status flips to 'Completed' (see the transaction-status
    rollup above, which persists that column before this function is ever
    called) — generate its normal/service invoice right away instead of
    waiting for the partner to click Download Invoice, same immediacy as a
    Reimbursement invoice at wallet-recharge time. Gating on orders.status
    directly (not re-deriving from b2b_esign_transaction) means a partial/
    intermediate signer event can never trigger this — only a genuine
    Submitted/Draft -> Completed transition does, and get_or_create_invoice_
    for_order's own existing-row check makes a duplicate/retried call here a
    no-op, so this can never double-invoice. Also fires the "Order Completed"
    notification here rather than a separate function, since it needs the
    exact same fetch-and-gate check — no reason to duplicate that logic.

    Covers both a plain eSign order and an eStamp order that had eSign
    attached afterwards (see stamp_service.initiate_stamp and the 'eStamp'
    branch of the rollup below) — either one lands here the moment its
    orders.status reaches 'Completed'.

    Called from both record_callback (a real SignDesk webhook) and
    admin_mark_signer_signed (the manual override), since either can be what
    completes the workflow. Never raises: a failure here must never break
    the webhook response back to SignDesk or the admin override request that
    triggered it — worst case, the invoice still generates lazily on first
    download, exactly as it always could.

    charge_wallet (see invoice_service.get_or_create_invoice_for_order) is
    passed False from both callers now — every signer's share was already
    converted from its block into a real debit individually, the moment
    THEY signed (see _apply_signer_status / partner._convert_partial_block_
    to_debit), so by the time the order reaches 'Completed' the full amount
    has already left the wallet. This call only ever produces the invoice
    DOCUMENT itself (still the same price_per_signer x signed_count total,
    computed fresh by invoice_service — unaffected by charge_wallet) —
    charging again here would double-debit.
    """
    from app.invoice_service import get_or_create_invoice_for_order
    from app.notification_service import notify_order_completed

    with get_connection() as connection:
        order = connection.execute(
            "SELECT organization_id, organization_user_id, service_name, status, order_no FROM orders WHERE id = %s",
            (order_id,),
        ).fetchone()
        if not order or order["service_name"] not in ("eSign", "eStamp") or order["status"] != "Completed":
            return

    try:
        get_or_create_invoice_for_order(
            order_id=order_id,
            organization_id=order["organization_id"],
            organization_user_id=order["organization_user_id"],
            charge_wallet=charge_wallet,
        )
    except Exception:
        logger.exception(
            "Auto invoice generation failed for eSign order %s after workflow completion — "
            "it will still generate lazily on first manual download.",
            order_id,
        )

    notify_order_completed(
        organization_id=order["organization_id"], order_id=order_id,
        order_no=order["order_no"], service_name=order["service_name"],
        organization_user_id=order["organization_user_id"],
    )


def record_callback(payload: dict[str, Any]) -> dict[str, Any]:
    """Public webhook handler — SignDesk posts here (see
    verify_esign_callback_secret in app/routes/esign.py for the auth gate).

    Handles both documented callback shapes via _extract_signer_entries: the
    Individual Callback (signer_info is a single object) and the Completion
    Callback (signer_info is an array covering every signer on the docket) —
    each entry is applied via _apply_signer_status. Also tolerates the legacy
    form-encoded return_url redirect shape (flat document_id/signer_id, no
    signer_info at all — see routes/esign.py's _parse_callback_body).

    Matched back to our records by (signdesk_document_id, signdesk_signer_id)
    per entry, since that's all the callback body reliably contains. Every
    callback is logged to b2b_esign_callback_log regardless of whether it
    matches anything, for audit/debugging.

    Returns the documented response shape — {"status": "success", "data":
    {...}} or {"status": "failed", "data": {...}, "error": {"code",
    "message"}} — for the route handler to send straight back to SignDesk.
    """
    document_id = payload.get("document_id")
    docket_id = payload.get("docket_id")
    status = str(payload.get("status") or "").lower()
    new_status = STATUS_MAP.get(status, "signed")
    # file_content is the documented field name; content is the legacy
    # return_url redirect's field name (see _parse_callback_body).
    signed_content = payload.get("file_content") or payload.get("content")
    # Best-effort — SignDesk's confirmed callback shape has none of these
    # today; kept so the UI picks them up automatically if they ever appear.
    opened_at = payload.get("opened_at") or payload.get("viewed_at")
    ip_address = payload.get("ip_address") or payload.get("ip")
    device_info = payload.get("device") or payload.get("user_agent") or payload.get("browser")

    signer_entries = _extract_signer_entries(payload)
    primary_signer_id = signer_entries[0].get("signer_id") or payload.get("signer_id")

    # Logged in its own transaction, unconditionally — including malformed or
    # unmatched callbacks — so the audit trail survives even when the rest of
    # this function goes on to reject or no-op the payload.
    with get_transaction() as log_connection:
        log_connection.execute(
            """
            INSERT INTO b2b_esign_callback_log (signdesk_document_id, signdesk_signer_id, payload)
            VALUES (%s, %s, %s)
            """,
            (document_id, primary_signer_id, Jsonb(payload)),
        )

    if not document_id:
        return {
            "status": "failed",
            "data": {"document_id": document_id, "docket_id": docket_id},
            "error": {"code": "missing_document_id", "message": "document_id is required"},
        }

    last_signer_id = None
    last_stakeholder_id = None
    any_signer_id_present = False
    saved_transactions: set = set()

    with get_transaction() as connection:
        for entry in signer_entries:
            entry_document_id = entry.get("document_id") or document_id
            signer_id = (
                entry.get("signer_id")
                or payload.get("signer_id")
                or _resolve_signer_id_by_email(
                    connection, document_id=entry_document_id, email=entry.get("email")
                )
            )
            if not signer_id:
                continue
            any_signer_id_present = True
            last_signer_id = signer_id
            last_stakeholder_id = entry.get("stakeholder_id") or payload.get("stakeholder_id")
            _apply_signer_status(
                connection,
                document_id=entry_document_id,
                signer_id=signer_id,
                new_status=new_status,
                opened_at=opened_at,
                ip_address=ip_address,
                device_info=device_info,
                payload=payload,
                signed_content=signed_content,
                saved_transactions=saved_transactions,
            )

    if not any_signer_id_present:
        return {
            "status": "failed",
            "data": {"document_id": document_id, "docket_id": docket_id},
            "error": {"code": "missing_signer_id", "message": "signer_id is required"},
        }

    # Best-effort: if this callback just completed the whole eSign workflow
    # (every signer reached a terminal state and the outcome was 'signed'),
    # generate the normal/service invoice document right away instead of
    # waiting for the partner to click Download Invoice — same immediacy as
    # before, but charge_wallet=False now: every signer's share was already
    # individually debited as they signed (see _apply_signer_status above),
    # so there's nothing left to charge here, only the invoice document
    # itself to produce. Runs after the transaction above commits, so the
    # just-updated status is actually visible to it.
    with get_connection() as lookup_connection:
        signer_row = lookup_connection.execute(
            "SELECT order_id FROM b2b_esign_signer WHERE signdesk_document_id = %s LIMIT 1",
            (document_id,),
        ).fetchone()
    if signer_row:
        _auto_generate_invoice_on_completion(signer_row["order_id"], charge_wallet=False)

    return {
        "status": "success",
        "data": {
            "document_id": document_id,
            "docket_id": docket_id,
            "signer_id": last_signer_id,
            "stakeholder_id": last_stakeholder_id,
        },
    }


def admin_get_esign_overview(order_id: UUID) -> dict[str, Any]:
    """Super Admin's unscoped view of an order's eSign workflow (unlike
    get_esign_status, not restricted to the signer's own organization) — the
    read side of the manual override below, so Super Admin can see which
    signers are still pending before deciding whether to override one."""
    with get_connection() as connection:
        order = connection.execute(
            "SELECT id AS order_id, order_no, service_name, organization_id FROM orders WHERE id = %s", (order_id,)
        ).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        transaction = connection.execute(
            """
            SELECT id AS transaction_id, status, docket_id, document_id, raw_response, created_at, updated_at
            FROM b2b_esign_transaction WHERE order_id = %s AND is_active = true
            """,
            (order_id,),
        ).fetchone()
        if not transaction:
            raise HTTPException(status_code=404, detail="No eSign request has been sent for this order yet")
        signers = connection.execute(
            """
            SELECT id, signer_name, signer_email, status, signed_at
            FROM b2b_esign_signer WHERE transaction_id = %s ORDER BY created_at ASC
            """,
            (transaction["transaction_id"],),
        ).fetchall()
    # initiate_esign's SignDeskError branch stores {"error": "..."} as this
    # transaction's raw_response — the only case worth surfacing here, so
    # Super Admin sees WHY this send failed (e.g. "this PDF already has a
    # signature") instead of just a bare "failed" badge with no explanation.
    raw_response = transaction.pop("raw_response", None)
    error = (raw_response or {}).get("error") if transaction["status"] == "failed" else None
    return {**order, **transaction, "error": error, "signers": signers}


def admin_mark_signer_signed(*, order_id: UUID, signer_id: UUID, admin_id: UUID, note: str) -> dict[str, Any]:
    """Manual override for when SignDesk's completion webhook never arrives
    (see record_callback) — Super Admin confirms the signer actually
    completed signing out-of-band (e.g. the signed-copy email SignDesk sends
    directly to the signer, independent of and not proof of the webhook
    firing) and flips them to Signed here instead of waiting indefinitely.

    Reuses _apply_signer_status exactly as the real webhook would — same
    transaction-status rollup, same auto-invoice-on-completion — so an
    overridden signature behaves identically to a real one. The one thing it
    can't do is attach a signed PDF snapshot (SignDesk only ever includes
    that in the webhook payload itself), so the original uploaded document
    remains this order's file. The override is recorded in
    raw_callback_payload (_admin_override: true, who, and why) so it's
    always distinguishable from a real SignDesk callback on inspection.
    """
    with get_transaction() as connection:
        signer = connection.execute(
            """
            SELECT s.id, s.signdesk_document_id, s.signdesk_signer_id, s.status
            FROM b2b_esign_signer s
            JOIN b2b_esign_transaction t ON t.id = s.transaction_id
            WHERE s.id = %s AND s.order_id = %s AND t.is_active = true
            """,
            (signer_id, order_id),
        ).fetchone()
        if not signer:
            raise HTTPException(status_code=404, detail="Signer not found on this order's active eSign workflow")
        if signer["status"] == "signed":
            raise HTTPException(status_code=400, detail="This signer is already marked as signed")
        if not signer["signdesk_document_id"] or not signer["signdesk_signer_id"]:
            raise HTTPException(
                status_code=400, detail="This signer hasn't been sent to SignDesk yet — nothing to override",
            )

        matched = _apply_signer_status(
            connection,
            document_id=signer["signdesk_document_id"],
            signer_id=signer["signdesk_signer_id"],
            new_status="signed",
            opened_at=None,
            ip_address=None,
            device_info=None,
            payload={"_admin_override": True, "overridden_by": str(admin_id), "note": note},
            signed_content=None,
            saved_transactions=set(),
        )
        if not matched:
            raise HTTPException(status_code=500, detail="Could not apply the override — signer match failed unexpectedly")

        result = connection.execute(
            "SELECT id, signer_name, status, signed_at FROM b2b_esign_signer WHERE id = %s", (signer_id,),
        ).fetchone()

    # charge_wallet=False: _apply_signer_status above already converted this
    # signer's (and every previously-signed signer's) share from block to a
    # real debit individually — nothing left to charge, only the invoice
    # document to produce once every signer is done.
    _auto_generate_invoice_on_completion(order_id, charge_wallet=False)
    return result
