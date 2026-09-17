"""
Admin Invoices API
------------------
GET  /api/admin/invoices                -> paginated + filtered list
GET  /api/admin/invoices/export-csv     -> CSV export
GET  /api/admin/invoices/{id}           -> single invoice
POST /api/admin/invoices/generate/{user_doc_id} -> generate for a paid order
GET  /api/admin/invoices/{id}/pdf       -> minimal hand-rolled PDF download

Covers the "Invoices" tab. The `invoice` table already exists live in this
database, so the original's ensure_invoice_table() bootstrap (which
CREATE TABLE IF NOT EXISTS'd it on every request) is dropped.
"""

import csv
from datetime import datetime
from io import BytesIO, StringIO
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, text
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.document import Document
from app.b2c_admin.models.invoice import Invoice
from app.b2c_admin.models.payment_transaction import PaymentTransaction
from app.b2c_admin.models.payment_transaction_meta import PaymentTransactionMeta
from app.b2c_admin.models.user import User
from app.b2c_admin.models.user_doc import UserDoc

router = APIRouter(prefix="/api/admin/invoices", tags=["admin-invoices"])


def money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def latest_payment(db: Session, user_doc_id: int) -> Optional[PaymentTransaction]:
    return (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.user_doc_id == user_doc_id)
        .order_by(desc(PaymentTransaction.id))
        .first()
    )


def payment_breakup(db: Session, payment: Optional[PaymentTransaction], doc: UserDoc) -> dict:
    if not payment:
        total = money(doc.amount_paid)
        return {
            "doc_price": total, "convenience_fee": 0.0, "delivery_fee": 0.0,
            "miscellaneous_charges": 0.0, "coupon_discount": 0.0,
            "cgst": 0.0, "sgst": 0.0, "igst": 0.0, "gst": 0.0, "total": total,
        }

    metas = db.query(PaymentTransactionMeta).filter(PaymentTransactionMeta.payment_id == payment.id).all()
    meta = {m.payment_meta_key: money(m.payment_meta_value) for m in metas}

    cgst = money(payment.cgst_value)
    sgst = money(payment.sgst_value)
    igst = money(payment.igst_value)
    total = meta.get("total") or money(doc.amount_paid) or (
        money(payment.doc_price)
        + meta.get("convenience_fee", 0)
        + meta.get("delivery_fee", 0)
        + meta.get("miscellaneous_charges", meta.get("misc", 0))
        + cgst + sgst + igst
        - meta.get("coupon_discount", 0)
    )

    return {
        "doc_price": money(payment.doc_price),
        "convenience_fee": meta.get("convenience_fee", 0.0),
        "delivery_fee": meta.get("delivery_fee", 0.0),
        "miscellaneous_charges": meta.get("miscellaneous_charges", meta.get("misc", 0.0)),
        "coupon_discount": meta.get("coupon_discount", 0.0),
        "cgst": cgst, "sgst": sgst, "igst": igst,
        "gst": round(cgst + sgst + igst, 2),
        "total": money(total),
    }


def invoice_payload(db: Session, invoice: Invoice) -> dict:
    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == invoice.user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Invoice order not found")

    user = db.query(User).filter(User.id == doc.user_id).first()
    document = db.query(Document).filter(Document.doc_id == doc.doc_id).first()
    payment = (
        db.query(PaymentTransaction).filter(PaymentTransaction.id == invoice.payment_transaction_id).first()
        if invoice.payment_transaction_id else latest_payment(db, doc.user_doc_id)
    )
    charges = payment_breakup(db, payment, doc)

    paid_at = doc.paid_date or (payment.transaction_datetime if payment else None)
    generated_at = invoice.generated_at
    return {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "user_doc_id": doc.user_doc_id,
        "payment_transaction_id": payment.id if payment else None,
        "customer_name": user.full_name if user else "Unknown",
        "customer_email": user.email if user else "",
        "document_name": document.doc_name if document else "Unknown Document",
        "amount": charges["total"],
        "doc_price": charges["doc_price"],
        "convenience_fee": charges["convenience_fee"],
        "delivery_fee": charges["delivery_fee"],
        "miscellaneous_charges": charges["miscellaneous_charges"],
        "coupon_discount": charges["coupon_discount"],
        "cgst": charges["cgst"], "sgst": charges["sgst"], "igst": charges["igst"], "gst": charges["gst"],
        "paid_date": paid_at.isoformat() if paid_at else None,
        "invoice_date": generated_at.isoformat() if generated_at else None,
        "payment_status": doc.payment_status or "pending",
        "status": bool(invoice.status),
        "paid_status": "Paid" if doc.payment_status == "success" else "Not Paid",
        "transaction_date": paid_at.isoformat() if paid_at else None,
    }


def next_invoice_number(db: Session) -> str:
    db.execute(text("SELECT pg_advisory_xact_lock(740021)"))
    last_number = db.execute(text("""
        SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 3) AS INTEGER)), 0)
        FROM invoice
        WHERE invoice_number ~ '^LD[0-9]+$'
    """)).scalar() or 0
    return f"LD{int(last_number) + 1:03d}"


@router.get("")
def list_invoices(
    invoice_number: Optional[str] = Query(None),
    customer_name: Optional[str] = Query(None),
    document_type: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    rows = (
        db.query(Invoice)
        .join(UserDoc, UserDoc.user_doc_id == Invoice.user_doc_id)
        .filter(UserDoc.payment_status == "success")
        .order_by(desc(Invoice.generated_at), desc(Invoice.id))
        .all()
    )

    invoices = [invoice_payload(db, row) for row in rows]

    def in_range(item):
        if start_date:
            try:
                if not item["invoice_date"] or datetime.fromisoformat(item["invoice_date"]).date() < datetime.strptime(start_date, "%Y-%m-%d").date():
                    return False
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid start_date format; use YYYY-MM-DD")
        if end_date:
            try:
                if not item["invoice_date"] or datetime.fromisoformat(item["invoice_date"]).date() > datetime.strptime(end_date, "%Y-%m-%d").date():
                    return False
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid end_date format; use YYYY-MM-DD")
        return True

    filtered = []
    for item in invoices:
        if invoice_number and invoice_number.lower() not in item["invoice_number"].lower():
            continue
        if customer_name and customer_name.lower() not in item["customer_name"].lower():
            continue
        if document_type and document_type != "all" and document_type.lower() not in item["document_name"].lower():
            continue
        if payment_status and payment_status != "all" and payment_status.lower() != item["payment_status"].lower():
            continue
        if search:
            needle = search.lower()
            haystack = " ".join([item["invoice_number"], item["customer_name"], item["customer_email"], item["document_name"], str(item["user_doc_id"])]).lower()
            if needle not in haystack:
                continue
        if not in_range(item):
            continue
        filtered.append(item)

    return {"total": len(filtered), "skip": skip, "limit": limit, "invoices": filtered[skip:skip + limit]}


@router.get("/export-csv")
def export_invoices_csv(
    invoice_number: Optional[str] = Query(None),
    customer_name: Optional[str] = Query(None),
    document_type: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_b2c_admin),
):
    data = list_invoices(
        invoice_number=invoice_number, customer_name=customer_name, document_type=document_type,
        payment_status=payment_status or ("success" if status == "paid" else status),
        start_date=start_date, end_date=end_date, search=search,
        skip=0, limit=1_000_000, db=db, current_user=current_user,
    )

    rows = data["invoices"]
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Invoice Number", "Customer Name", "Customer Email", "Document Name", "Amount", "GST", "Paid Date", "Invoice Date", "Status"])
    for row in rows:
        writer.writerow([
            row["invoice_number"], row["customer_name"], row["customer_email"], row["document_name"],
            f"{money(row['amount']):.2f}", f"{money(row['gst']):.2f}",
            row["paid_date"] or "", row["invoice_date"] or "", row["paid_status"],
        ])

    output.seek(0)
    filename = f"legaldesk_invoices_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice_payload(db, invoice)


@router.post("/generate/{user_doc_id}")
def generate_invoice(user_doc_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    doc = db.query(UserDoc).filter(UserDoc.user_doc_id == user_doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    if doc.payment_status != "success" and not doc.is_paid:
        raise HTTPException(status_code=400, detail="Invoice can be generated only for paid orders")

    existing = db.query(Invoice).filter(Invoice.user_doc_id == user_doc_id).first()
    if existing:
        return invoice_payload(db, existing)

    payment = latest_payment(db, user_doc_id)
    invoice = Invoice(
        invoice_number=next_invoice_number(db),
        user_doc_id=user_doc_id,
        payment_transaction_id=payment.id if payment else None,
        generated_by=current_user["id"],
        status=True,
    )
    db.add(invoice)
    try:
        db.commit()
    except Exception:
        db.rollback()
        existing = db.query(Invoice).filter(Invoice.user_doc_id == user_doc_id).first()
        if existing:
            return invoice_payload(db, existing)
        raise
    db.refresh(invoice)
    return invoice_payload(db, invoice)


def escape_pdf_text(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def simple_pdf(lines: list[str]) -> bytes:
    content = ["BT", "/F1 12 Tf", "50 790 Td", "16 TL"]
    for idx, line in enumerate(lines):
        if idx:
            content.append("T*")
        content.append(f"({escape_pdf_text(line)}) Tj")
    content.append("ET")
    stream = "\n".join(content).encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(pdf.tell())
        pdf.write(f"{i} 0 obj\n".encode())
        pdf.write(obj)
        pdf.write(b"\nendobj\n")
    xref = pdf.tell()
    pdf.write(f"xref\n0 {len(objects) + 1}\n".encode())
    pdf.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.write(f"{offset:010d} 00000 n \n".encode())
    pdf.write(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return pdf.getvalue()


@router.get("/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    data = invoice_payload(db, invoice)
    lines = [
        "LegalDesk Invoice",
        f"Invoice Number: {data['invoice_number']}",
        f"Invoice Date: {data['invoice_date'] or ''}",
        "",
        f"Customer: {data['customer_name']}",
        f"Email: {data['customer_email']}",
        f"Document: {data['document_name']}",
        f"Paid Date: {data['paid_date'] or ''}",
        "",
        f"Document Fees: Rs. {data['doc_price']:.2f}",
        f"Convenience Fees: Rs. {data['convenience_fee']:.2f}",
        f"Delivery Charges: Rs. {data['delivery_fee']:.2f}",
        f"Miscellaneous Charges: Rs. {data['miscellaneous_charges']:.2f}",
        f"CGST: Rs. {data['cgst']:.2f}",
        f"SGST: Rs. {data['sgst']:.2f}",
        f"IGST: Rs. {data['igst']:.2f}",
        f"Coupon Discount: Rs. {data['coupon_discount']:.2f}",
        f"Total Paid: Rs. {data['amount']:.2f}",
        "",
        "Payment Status: Paid",
    ]
    filename = f"{data['invoice_number']}.pdf"
    return StreamingResponse(
        BytesIO(simple_pdf(lines)),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
