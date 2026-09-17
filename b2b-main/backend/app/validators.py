import re
from typing import Literal

MOBILE_RE = re.compile(r"^\d{10}$")
# Real Indian mobile numbers always start with 6, 7, 8, or 9 — plain
# MOBILE_RE accepts any 10 digits (e.g. "1234567890"), which SignDesk's
# eSign Sign Request API rejects server-side with "The signer_mobile value
# used in the request is incorrect", but only after the order has already
# been created. Used only for the eSign signer_mobile field specifically
# (see esign_service.SignerIn and routes/api_v1.EsignInitiateRequest) so
# that gets caught at submission time instead; every other mobile field in
# the app (org/vendor/customer contact numbers, eStamp's duty payer phone)
# keeps the plain 10-digit check since they don't hit that same API.
INDIAN_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")

PDF_MAGIC = b"%PDF-"
JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# Hard cap for order document uploads — prevents oversized payloads from
# being buffered entirely in memory during validation.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Services whose create-order flow must accept only a real, safe PDF
# (extension/Content-Type alone are not trusted — clients can spoof both).
PDF_REQUIRED_SERVICES = frozenset({"eSign", "eStamp", "eStamp On The Fly"})

# PDF active content / HTML polyglot markers that enable script execution
# when the file is later opened or previewed. Matched against raw bytes so
# renamed .html/.doc payloads and PDFs with embedded JS are both rejected.
# Deliberately excludes common benign keys (/OpenAction, /AA, /XFA) that
# appear in ordinary business / stamp-duty PDFs and would false-positive.
_PDF_DANGEROUS_PATTERNS = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        rb"/JavaScript\b",
        rb"/JS[\s/<\[(]",
        rb"/Launch\b",
        rb"/RichMedia\b",
        rb"<\s*script\b",
        rb"javascript\s*:",
        rb"<\s*html\b",
        rb"<\s*iframe\b",
        rb"<\s*svg\b",
    )
)


def validate_mobile(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if not MOBILE_RE.match(value):
        raise ValueError("mobile number must be exactly 10 digits")
    return value


def validate_indian_mobile(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if not INDIAN_MOBILE_RE.match(value):
        raise ValueError("mobile number must be a valid 10-digit Indian mobile number (starting with 6-9)")
    return value


def is_valid_pdf_bytes(data: bytes) -> bool:
    """True when the payload starts with the PDF magic number."""
    return bool(data) and data[:5] == PDF_MAGIC


def pdf_contains_dangerous_content(data: bytes) -> bool:
    """True when the PDF bytes include embedded script / active-content markers."""
    return any(pattern.search(data) for pattern in _PDF_DANGEROUS_PATTERNS)


def validate_safe_pdf_bytes(data: bytes) -> None:
    """
    Server-side PDF gate for uploads that will later be previewed or sent to
    eSign/eStamp. Rejects non-PDFs (even if the filename/Content-Type claim
    otherwise) and PDFs that embed JavaScript / HTML polyglot payloads.
    """
    if not data:
        raise ValueError("Document file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Document exceeds the maximum allowed size of {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if not is_valid_pdf_bytes(data):
        raise ValueError(
            "Document must be a valid PDF file (file content does not match a PDF). "
            "Renaming another file type to .pdf is not accepted."
        )
    if pdf_contains_dangerous_content(data):
        raise ValueError(
            "Document was rejected because it contains embedded scripts or other "
            "active content that is not allowed"
        )


def detect_ekyc_upload_kind(data: bytes) -> Literal["pdf", "jpeg", "png"]:
    """eKYC accepts JPEG, PNG, or a safe PDF — detected from magic bytes only."""
    if not data:
        raise ValueError("Document file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Document exceeds the maximum allowed size of {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if is_valid_pdf_bytes(data):
        validate_safe_pdf_bytes(data)
        return "pdf"
    if data.startswith(JPEG_MAGIC):
        return "jpeg"
    if data.startswith(PNG_MAGIC):
        return "png"
    raise ValueError("eKYC document must be a valid PDF, JPEG, or PNG file (content does not match)")


def safe_stored_pdf_filename(original_filename: str | None) -> str:
    """Normalize the client-facing filename to a .pdf suffix after validation."""
    name = (original_filename or "document.pdf").strip() or "document.pdf"
    # Strip path components from spoofed multipart filenames.
    name = name.replace("\\", "/").split("/")[-1]
    if not name.lower().endswith(".pdf"):
        base = name.rsplit(".", 1)[0] if "." in name else name
        name = f"{base or 'document'}.pdf"
    return name[:200]


def safe_stored_filename_for_kind(original_filename: str | None, kind: Literal["pdf", "jpeg", "png"]) -> str:
    ext = {"pdf": ".pdf", "jpeg": ".jpg", "png": ".png"}[kind]
    name = (original_filename or f"document{ext}").strip() or f"document{ext}"
    name = name.replace("\\", "/").split("/")[-1]
    if not name.lower().endswith(ext) and not (kind == "jpeg" and name.lower().endswith(".jpeg")):
        base = name.rsplit(".", 1)[0] if "." in name else name
        name = f"{base or 'document'}{ext}"
    return name[:200]
