from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.database import get_connection

# Same 21-state list as frontend/B2B LD/src/lib/stampConstants.js's
# STAMP_STATES (SignDesk DSS 2.0 API doc, Annexure 2.1: states where eStamp
# is available) — kept in sync manually since one lives in Python and the
# other in JS. Maps the organization's real onboarding state (state.state_name)
# to the 2-letter code SignDesk's stamp_state parameter expects.
STATE_NAME_TO_SIGNDESK_STAMP_CODE: dict[str, str] = {
    "Andhra Pradesh": "AP",
    "Delhi": "DL",
    "Haryana": "HR",
    "Karnataka": "KA",
    "Kerala": "KL",
    "Maharashtra": "MH",
    "Tamil Nadu": "TN",
    "Telangana": "TS",
    "Uttar Pradesh": "UP",
    "West Bengal": "WB",
    "Gujarat": "GJ",
    "Madhya Pradesh": "MP",
    "Assam": "AS",
    "Bihar": "BR",
    "Chhattisgarh": "CG",
    "Goa": "GA",
    "Himachal Pradesh": "HP",
    "Jammu and Kashmir": "JK",
    "Orissa": "OD",
    "Punjab": "PB",
    "Rajasthan": "RJ",
    "Uttarakhand": "UK",
}

def get_organization_state(organization_id: UUID) -> dict[str, Any] | None:
    """The organization's own onboarding state (organizations.state_id, set
    by Super Admin in Edit Partner) — display-only now (see the Partner User
    profile endpoint); order creation itself no longer depends on this, each
    eStamp/eStamp Bulk/Manual eStamp order collects its own state instead
    (see resolve_stamp_state_code below). None means Super Admin never set one."""
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT o.state_id, s.state_name
            FROM organizations o
            LEFT JOIN state s ON s.id = o.state_id
            WHERE o.id = %s
            """,
            (organization_id,),
        ).fetchone()
    if not row or not row["state_id"]:
        return None
    return {"state_id": row["state_id"], "state_name": row["state_name"]}


def resolve_stamp_state_code(state_name: str) -> str:
    """Maps a state name picked per-order on the eStamp create-order form to
    SignDesk's 2-letter stamp_state code, raising a clear error if eStamp
    isn't available there (SignDesk only covers 21 of India's states/UTs —
    see STATE_NAME_TO_SIGNDESK_STAMP_CODE)."""
    code = STATE_NAME_TO_SIGNDESK_STAMP_CODE.get(state_name)
    if not code:
        raise HTTPException(status_code=400, detail=f"eStamp is not available for {state_name}.")
    return code
