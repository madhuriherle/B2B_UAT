import sys
import json
sys.path.insert(0, '.')
from app.database import get_connection
with get_connection() as conn:
    user = conn.execute("SELECT id, email, is_active, role, password_hash, two_factor_enabled FROM users WHERE email='admin@legaldesk.com'").fetchone()
    if user:
        print(dict(user))
    else:
        print("Not Found")
