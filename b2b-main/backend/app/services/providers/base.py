from dataclasses import dataclass
from typing import Any


# Every provider function (signdesk.py today; leegality.py/digio.py later)
# returns this same shape, so the /api/v1 router never needs to know which
# provider actually handled the call.
@dataclass
class ProviderResult:
    success: bool
    http_status: int
    provider_reference_id: str | None
    response_payload: dict[str, Any]
    error_message: str | None = None
