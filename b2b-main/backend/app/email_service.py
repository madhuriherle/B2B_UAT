import html
import logging
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

from app.config import load_backend_env

load_backend_env()

logger = logging.getLogger(__name__)

_DEFAULT_LOGO_PATH = Path(__file__).resolve().parent / "assets" / "legaldesk_logo.png"


def _smtp_settings() -> tuple[str, int, str, str, str]:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    mail_from = os.getenv("MAIL_FROM", smtp_user or "")

    if not smtp_host or not smtp_user or not smtp_password or not mail_from:
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.")
    if "your-email" in smtp_user or "your-email" in mail_from:
        raise RuntimeError("SMTP still has placeholder email values. Replace SMTP_USER and MAIL_FROM in backend/.env.")
    return smtp_host, smtp_port, smtp_user, smtp_password, mail_from


def _legaldesk_from_header(mail_from: str) -> str:
    """From display name is always LegalDesk — never Melento's
    "Name via Melento" branded sender."""
    # MAIL_FROM may already be "Name <addr@…>"; keep only the address.
    address = mail_from
    if "<" in mail_from and ">" in mail_from:
        address = mail_from.split("<", 1)[1].rsplit(">", 1)[0].strip()
    return formataddr(("LegalDesk", address))


def send_esign_invitation_email(
    *,
    to_email: str,
    signer_name: str,
    inviter_name: str,
    document_name: str,
    invitation_link: str,
    reply_to: str | None = None,
) -> None:
    """LegalDesk-branded eSign invitation. Replaces Melento's default invite
    email (which shows "Name via Melento" and the Melento logo)."""
    smtp_host, smtp_port, smtp_user, smtp_password, mail_from = _smtp_settings()

    safe_signer = html.escape(signer_name or "")
    safe_inviter = html.escape(inviter_name or "LegalDesk")
    safe_document = html.escape(document_name or "document")
    safe_link = html.escape(invitation_link, quote=True)

    message = EmailMessage()
    message["Subject"] = f"Invitation to sign - {document_name}"
    message["From"] = _legaldesk_from_header(mail_from)
    message["To"] = to_email
    if reply_to:
        message["Reply-To"] = reply_to

    message.set_content(
        f"""Hello {signer_name or ''},

{inviter_name or 'LegalDesk'} has invited you to sign {document_name}.

You can now sign {document_name}. Please read through the document before signing it.

Sign here:
{invitation_link}
"""
    )

    html_body = f"""\
<html>
  <body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:28px 28px 8px 28px;text-align:center;">
          <img src="cid:legaldesk_logo" alt="LegalDesk" style="height:48px;width:auto;max-width:240px;" />
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px 8px 28px;text-align:center;">
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#111827;">You've Been Invited</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px;text-align:center;font-size:15px;line-height:1.5;">
          <p style="margin:0 0 12px 0;">{safe_inviter} has invited you to sign <strong>{safe_document}</strong></p>
          <p style="margin:0 0 24px 0;color:#4b5563;">You can now sign <strong>{safe_document}</strong>. Please read through the document before signing it.</p>
          <a href="{safe_link}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:15px;">Sign Document</a>
          <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">Hello {safe_signer}, if the button does not work, open this link:<br />
            <a href="{safe_link}" style="color:#6d28d9;word-break:break-all;">{safe_link}</a>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 28px 28px;text-align:center;font-size:12px;color:#9ca3af;">
          Sent by LegalDesk
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    message.add_alternative(html_body, subtype="html")

    logo_path = Path(os.getenv("LEGALDESK_EMAIL_LOGO_PATH") or _DEFAULT_LOGO_PATH)
    if logo_path.is_file():
        logo_bytes = logo_path.read_bytes()
        html_part = message.get_payload()[-1]
        html_part.add_related(
            logo_bytes,
            maintype="image",
            subtype="png",
            cid="<legaldesk_logo>",
        )
    else:
        logger.warning("LegalDesk email logo not found at %s — sending invitation without embedded logo.", logo_path)

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password.replace(" ", ""))
        server.send_message(message)


def send_quotation_email(
    *,
    to_email: str,
    organization_name: str,
    services: list[str],
    amount: float,
    gst_percentage: float,
    quotation_link: str,
) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    mail_from = os.getenv("MAIL_FROM", smtp_user or "")

    if not smtp_host or not smtp_user or not smtp_password or not mail_from:
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.")
    if "your-email" in smtp_user or "your-email" in mail_from:
        raise RuntimeError("SMTP still has placeholder email values. Replace SMTP_USER and MAIL_FROM in backend/.env.")

    message = EmailMessage()
    message["Subject"] = "Your LegalDesk quotation has been generated"
    message["From"] = mail_from
    message["To"] = to_email
    message.set_content(
        f"""Hello {organization_name},

Your quotation has been generated.

Services:
{chr(10).join(f"- {service}" for service in services)}

Amount: Rs.{amount:.2f} + GST {gst_percentage:.2f}%

Click below to continue:
{quotation_link}
"""
    )

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password.replace(" ", ""))
        server.send_message(message)


def send_esign_link_outdated_email(
    *,
    to_email: str,
    to_name: str,
    order_no: str,
    new_invitation_link: str | None,
) -> None:
    """Sent when a signer completes (or attempts to complete) signing on a
    workflow we've since superseded (e.g. the requester edited signer
    details and resent). SignDesk's own hosted signing page has no idea the
    workflow was cancelled on our side, so the signer sees a normal
    "success" page there and would otherwise have no way of knowing their
    signature was never actually recorded — this email closes that gap."""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    mail_from = os.getenv("MAIL_FROM", smtp_user or "")

    if not smtp_host or not smtp_user or not smtp_password or not mail_from:
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.")
    if "your-email" in smtp_user or "your-email" in mail_from:
        raise RuntimeError("SMTP still has placeholder email values.")

    message = EmailMessage()
    message["Subject"] = f"Your signing link for order {order_no} is no longer valid"
    message["From"] = mail_from
    message["To"] = to_email

    link_section = (
        f"A new, valid signing link has been sent to you separately — please use that one:\n{new_invitation_link}\n"
        if new_invitation_link
        else "A new signing request should be sent to you shortly — please check your inbox, "
        "or contact whoever requested your signature if you don't receive one.\n"
    )
    message.set_content(
        f"""Hello {to_name},

The document signing link you just used for order {order_no} has been replaced with an updated
version (the requester made a correction after the original request was sent) — any signature
made on that old link could not be recorded, even if it showed as successful.

{link_section}
If you believe this is a mistake, please contact the requester directly.
"""
    )

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password.replace(" ", ""))
        server.send_message(message)


def send_otp_email(
    *,
    to_email: str,
    full_name: str,
    otp_code: str,
    expires_in_minutes: int,
) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    mail_from = os.getenv("MAIL_FROM", smtp_user or "")

    if not smtp_host or not smtp_user or not smtp_password or not mail_from:
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.")
    if "your-email" in smtp_user or "your-email" in mail_from:
        raise RuntimeError("SMTP still has placeholder email values.")

    message = EmailMessage()
    message["Subject"] = f"Your LegalDesk login code: {otp_code}"
    message["From"] = mail_from
    message["To"] = to_email
    message.set_content(
        f"""Hello {full_name or ''},

Your one-time login code is:

{otp_code}

This code will expire in {expires_in_minutes} minutes. If you did not attempt to log in, you can safely ignore this email.
"""
    )

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password.replace(" ", ""))
        server.send_message(message)


def send_password_reset_email(
    *,
    to_email: str,
    full_name: str,
    reset_link: str,
) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    mail_from = os.getenv("MAIL_FROM", smtp_user or "")

    if not smtp_host or not smtp_user or not smtp_password or not mail_from:
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.")
    if "your-email" in smtp_user or "your-email" in mail_from:
        raise RuntimeError("SMTP still has placeholder email values.")

    message = EmailMessage()
    message["Subject"] = "Your account has been created – Set your password"
    message["From"] = mail_from
    message["To"] = to_email
    message.set_content(
        f"""Hello {full_name},

Your account has been created on LegalDesk.

Please click the link below to set your password:
{reset_link}

This link will expire in 24 hours.

If you did not expect this email, please ignore it.
"""
    )

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password.replace(" ", ""))
        server.send_message(message)
