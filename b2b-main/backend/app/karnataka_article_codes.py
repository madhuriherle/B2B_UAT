from fastapi import HTTPException

# Article codes for "eStamp On The Fly" states that use SignDesk's SHCIL
# on-the-fly stamp mechanism (stamp_type="shcil") — as opposed to
# Maharashtra's eSBTR mechanism, which has no article-code concept at all
# and is handled entirely separately (see maharashtra_esbtr_districts.py).
# File kept as "karnataka_article_codes.py" (not renamed) since Karnataka
# remains the only state with a fully SignDesk-confirmed list; Tamil Nadu
# and Delhi were added later from a smaller, less-verified sheet (see below).
#
# Karnataka's first 47 entries are the AUTHORITATIVE list SignDesk
# (Disha J Suvarna, 2026-09-01) confirmed is actually configured for this
# account in UAT, including the exact document_category each article maps
# to. Supersedes the earlier 119-entry guess-based list (which was just what
# we submitted, not confirmed as configured) — that list is why
# document_category was previously a separate, independently-picked field;
# now it's derived from the article alone, since each article has exactly
# one correct document_category on this account.
#
# Only those 47 of our originally-submitted ~119 Karnataka articles are
# actually configured — picking any article not in this list means it isn't
# available yet; ask SignDesk to add it if needed.
#
# The last 2 Karnataka entries, and the entire Tamil Nadu/Delhi lists, came
# from a later multi-state CSV (2026-09-03) that was NOT run through the
# same SignDesk confirmation SignDesk gave the 47 above — the
# digital_article_code format doesn't even match (short "89"/"10" vs the
# zero-padded "0090"/"0010" style SignDesk actually confirmed). Treat these
# as unverified until a real order using one of them succeeds — don't
# assume they're configured on this account just because they're listed
# here.
ARTICLE_CODES_BY_STATE: dict[str, list[dict[str, object]]] = {
    "Karnataka": [
        {"document_category": 546, "article_number": "2(a)", "digital_article_code": "0112", "article_name": "Administration Bond - Upto Rs.1000/-"},
        {"document_category": 108, "article_number": "3", "digital_article_code": "0003", "article_name": "Adoption Deed"},
        {"document_category": 8, "article_number": "4", "digital_article_code": "0004", "article_name": "Affidavit"},
        {"document_category": 1, "article_number": "5(J)", "digital_article_code": "0022", "article_name": "Agreement (in any other cases)"},
        {"document_category": 357, "article_number": "9", "digital_article_code": "0030", "article_name": "Apprenticeship Deed"},
        {"document_category": 395, "article_number": "12(a)", "digital_article_code": "0032", "article_name": "Bond - Amount secured does not exceed Rs.1000"},
        {"document_category": 396, "article_number": "12(b)", "digital_article_code": "0033", "article_name": "Bond - Amount exceeding Rs.1000"},
        {"document_category": 227, "article_number": "17", "digital_article_code": "0039", "article_name": "Certificate of Enrolment as Advocate"},
        {"document_category": 25, "article_number": "22", "digital_article_code": "0047", "article_name": "Counter part or Duplicate"},
        {"document_category": 27, "article_number": "23", "digital_article_code": "0048", "article_name": "Customs Bond or Excise Bond Art 23(b)"},
        {"document_category": 16, "article_number": "29", "digital_article_code": "0054", "article_name": "Indemnity Bond (As per Article 47)"},
        {"document_category": 420, "article_number": "30(2)(a)(ii)", "digital_article_code": "0058", "article_name": "Lease of Movable Property - Above 10 years"},
        {"document_category": 421, "article_number": "30(2)(b)", "digital_article_code": "0059", "article_name": "Lease of Movable Property - Lease granted for fine or premium but no rent"},
        {"document_category": 422, "article_number": "30(2)(c)", "digital_article_code": "0060", "article_name": "Lease of Movable Property - Lease for fine premium and also rent"},
        {"document_category": 313, "article_number": "31", "digital_article_code": "0061", "article_name": "Letter of Allotment"},
        {"document_category": 390, "article_number": "32-A (i)", "digital_article_code": "0062", "article_name": "Letter of License - Not more than 1 year in case of residential property"},
        {"document_category": 386, "article_number": "32-A(ii)", "digital_article_code": "0063", "article_name": "Letter of License - Not more than 1 year in case of commercial industrial property"},
        {"document_category": 387, "article_number": "32-A(iii)", "digital_article_code": "0064", "article_name": "Letter of License - 1 year to 10 year"},
        {"document_category": 388, "article_number": "32-A(iv)", "digital_article_code": "0065", "article_name": "Letter of License - 10 year to 20 year"},
        {"document_category": 389, "article_number": "32-A(v)", "digital_article_code": "0066", "article_name": "Letter of License - 20 to 30 year"},
        {"document_category": 315, "article_number": "33", "digital_article_code": "0067", "article_name": "Memorandum of Association of a company"},
        {"document_category": 435, "article_number": "34(d)(i)", "digital_article_code": "0068", "article_name": "Mortgage Deed - Hypothecation of movable property loan upto Rs.10 lakh"},
        {"document_category": 436, "article_number": "34(d)(ii)", "digital_article_code": "0069", "article_name": "Mortgage Deed - loan exceeding 10 lakhs"},
        {"document_category": 34, "article_number": "40(B)(b)", "digital_article_code": "0083", "article_name": "Partnership - Reconstitution"},
        {"document_category": 423, "article_number": "40(C)", "digital_article_code": "0084", "article_name": "Partnership - Dissolution"},
        {"document_category": 359, "article_number": "40A(a)", "digital_article_code": "0085", "article_name": "Limited Liability Partnership - Capital Upto Rs.10 lakhs"},
        {"document_category": 455, "article_number": "40A(b)", "digital_article_code": "0086", "article_name": "Limited Liability Partnership - Capital more than Rs.10 lakhs"},
        {"document_category": 381, "article_number": "41(e)", "digital_article_code": "0090", "article_name": "Power of Attorney - Authorizing to sell property"},
        {"document_category": 383, "article_number": "41(f)", "digital_article_code": "0094", "article_name": "Power of Attorney - when given for trading operation"},
        {"document_category": 384, "article_number": "41(g)", "digital_article_code": "0095", "article_name": "Power of Attorney - when given for depository participant"},
        {"document_category": 385, "article_number": "41(h)", "digital_article_code": "0096", "article_name": "Power of Attorney - in any other case"},
        {"document_category": 417, "article_number": "12(a)", "digital_article_code": "0100", "article_name": "Respondentia Bond - Amount Secured does not exceed Rs.1000"},
        {"document_category": 5, "article_number": "47", "digital_article_code": "0102", "article_name": "Security Bond or Mortgage Deed"},
        {"document_category": 180, "article_number": "49", "digital_article_code": "0103", "article_name": "Share Warrants (Art No.47(b))"},
        {"document_category": 377, "article_number": "41(a)", "digital_article_code": "0113", "article_name": "Power of Attorney - for admitting executing of document"},
        {"document_category": 379, "article_number": "41(c)", "digital_article_code": "0116", "article_name": "Power of Attorney - for authorising more than 5 person to act jointly"},
        {"document_category": 424, "article_number": "40(C)(b)", "digital_article_code": "0124", "article_name": "Partnership - Dissolution - Immovable properties"},
        {"document_category": 314, "article_number": "32", "digital_article_code": "0125", "article_name": "Letter of licence"},
        {"document_category": 547, "article_number": "56(ii)", "digital_article_code": "0127", "article_name": "Bank Guarantee - If relating to e-bank guarantee"},
        {"document_category": 212, "article_number": "7", "digital_article_code": "0027", "article_name": "Appointment in execution of a power"},
        {"document_category": 216, "article_number": "19", "digital_article_code": "0044", "article_name": "Composition Deed"},
        {"document_category": 360, "article_number": "30(1)(i)", "digital_article_code": "0055", "article_name": "Lease of Immovable Property - Not exceeding 1 year in case of Residential property"},
        {"document_category": 361, "article_number": "30(1)(ii)", "digital_article_code": "0056", "article_name": "Lease of Immovable Property - Not exceeding 1 year in case of commercial industrial property"},
        {"document_category": 382, "article_number": "41(eb)", "digital_article_code": "0092", "article_name": "Power of Attorney - when sale power given to other than family members"},
        {"document_category": 378, "article_number": "41(b)", "digital_article_code": "0115", "article_name": "Power of Attorney - for authorising one or more person to act in a single transaction"},
        {"document_category": 302, "article_number": "53A", "digital_article_code": "DR2", "article_name": "Transfer of License"},
        {"document_category": 419, "article_number": "30(2)", "digital_article_code": "0057", "article_name": "Lease of Movable Property - Lease of movable property rent fixed, no premium 30(2)(a)(i) upto 10 years"},
        # Unverified — see module docstring above.
        {"document_category": 380, "article_number": "41(d)", "digital_article_code": "89", "article_name": "Power of Attorney - authorizing more than 5 to 10 persons to act jointly in more than one transaction or generally"},
        {"document_category": 47, "article_number": "5(c)(ii)", "digital_article_code": "10", "article_name": "Memorandum of Association"},
    ],
    # Unverified — see module docstring above. Neither state has been
    # exercised against SignDesk live yet.
    "Tamil Nadu": [
        {"document_category": 226, "article_number": "19", "digital_article_code": "1018", "article_name": "Certificate or other document evidencing right/title to share, script or stock"},
        {"document_category": 220, "article_number": None, "digital_article_code": "1067", "article_name": "Revocation of, or concerning, any property (other than by Will)"},
    ],
    "Delhi": [
        {"document_category": 380, "article_number": "48(e)", "digital_article_code": "1044", "article_name": "Power of Attorney - GPA for more than five persons but less than ten persons"},
    ],
}

# 2-letter SignDesk stamp_state code per SHCIL-type state name — Maharashtra
# ("MH") isn't here since it's eSBTR, not SHCIL, and is handled entirely
# separately in stamp_service.py.
SHCIL_STATE_CODES: dict[str, str] = {
    "Karnataka": "KA",
    "Tamil Nadu": "TN",
    "Delhi": "DL",
}

ARTICLE_BY_DIGITAL_CODE_BY_STATE: dict[str, dict[str, dict[str, object]]] = {
    state: {entry["digital_article_code"]: entry for entry in entries}
    for state, entries in ARTICLE_CODES_BY_STATE.items()
}

# Flat name kept for backward compatibility with any code still importing
# the old Karnataka-only lookup directly.
KARNATAKA_ARTICLE_BY_DIGITAL_CODE = ARTICLE_BY_DIGITAL_CODE_BY_STATE["Karnataka"]


def resolve_article(state: str, digital_article_code: str) -> dict[str, object]:
    """Validates a client-submitted digital_article_code against the list
    configured for `state` specifically — a code valid for one SHCIL state
    is still rejected for another, even though the flat set of all codes
    across states may overlap in value by coincidence. The returned entry's
    document_category is authoritative — callers must use it to build the
    request, never a client-submitted document_category (see
    stamp_service._build_request_payload_otf)."""
    entry = ARTICLE_BY_DIGITAL_CODE_BY_STATE.get(state, {}).get(digital_article_code)
    if not entry:
        raise HTTPException(status_code=400, detail=f"'{digital_article_code}' is not a recognized {state} article code.")
    return entry


def resolve_karnataka_article(digital_article_code: str) -> dict[str, object]:
    """Backward-compatible Karnataka-only wrapper around resolve_article."""
    return resolve_article("Karnataka", digital_article_code)
