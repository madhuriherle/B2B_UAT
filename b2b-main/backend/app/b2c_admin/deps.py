from typing import Any

from fastapi import Depends

from app.auth import get_current_platform_admin

# Same session, same auth system as the rest of B2B — get_current_platform_admin
# is B2B's own JWT-backed dependency (checks role == "platform_admin" on the
# shared `users` table). No second login, no separate token.
#
# Used by most of this package's routes, but NOT by admin_orders.py /
# admin_reports.py — those two depend on app.auth.get_current_admin directly
# instead, so B2B Super Admin ('admin') can reach Orders/Reports while
# staying locked out of the rest of the B2C admin module.
def get_current_b2c_admin(current_user: dict[str, Any] = Depends(get_current_platform_admin)) -> dict[str, Any]:
    return current_user
