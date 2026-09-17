import secrets
import string
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from psycopg.errors import UniqueViolation

from app.database import get_connection
from app.validators import validate_mobile

router = APIRouter()

ALLOWED_SERVICE_CHOICES = ("eSign", "eStamp", "eKYC")

# Never derived from anything client-supplied — the company doesn't choose
# this, so it must come from a CSPRNG, not `random`/uuid4 (which are
# predictable/lower-entropy for this purpose).
_API_KEY_ALPHABET = string.ascii_letters + string.digits
_API_KEY_RANDOM_LENGTH = 40


def _generate_api_key() -> str:
    random_part = "".join(secrets.choice(_API_KEY_ALPHABET) for _ in range(_API_KEY_RANDOM_LENGTH))
    return f"ld_live_{random_part}"


def _validate_services(services: list[str]) -> list[str]:
    invalid = [s for s in services if s not in ALLOWED_SERVICE_CHOICES]
    if invalid:
        raise ValueError(f"allowed_services must only contain {ALLOWED_SERVICE_CHOICES}, got {invalid}")
    return services


class ApiClientCreate(BaseModel):
    company_name: str
    contact_person: str | None = None
    email: EmailStr
    mobile: str | None = None
    callback_url: str | None = None
    allowed_services: list[str] = []
    is_active: bool = True

    _validate_mobile = field_validator("mobile")(validate_mobile)
    _validate_services = field_validator("allowed_services")(_validate_services)


class ApiClientUpdate(BaseModel):
    company_name: str | None = None
    contact_person: str | None = None
    email: EmailStr | None = None
    mobile: str | None = None
    callback_url: str | None = None
    allowed_services: list[str] | None = None
    is_active: bool | None = None

    _validate_mobile = field_validator("mobile")(validate_mobile)
    _validate_services = field_validator("allowed_services")(_validate_services)


@router.get("")
def list_api_clients() -> list[dict[str, Any]]:
    with get_connection() as connection:
        return connection.execute("SELECT * FROM api_clients ORDER BY created_at DESC").fetchall()


@router.post("", status_code=201)
def create_api_client(payload: ApiClientCreate) -> dict[str, Any]:
    # api_id is left out of the INSERT column list so the table's DEFAULT
    # (nextval on api_client_id_seq) generates it — api_key has no DB-side
    # equivalent for a cryptographically random secret, so it's generated here.
    sql = """
        INSERT INTO api_clients (
            company_name, contact_person, email, mobile,
            callback_url, allowed_services, is_active, api_key
        )
        VALUES (
            %(company_name)s, %(contact_person)s, %(email)s, %(mobile)s,
            %(callback_url)s, %(allowed_services)s, %(is_active)s, %(api_key)s
        )
        RETURNING *
    """
    params = {**payload.model_dump(), "api_key": _generate_api_key()}
    with get_connection() as connection:
        try:
            return connection.execute(sql, params).fetchone()
        except UniqueViolation:
            raise HTTPException(status_code=409, detail=f"An API client with email '{payload.email}' already exists")


@router.get("/{client_id}")
def get_api_client(client_id: UUID) -> dict[str, Any]:
    with get_connection() as connection:
        client = connection.execute("SELECT * FROM api_clients WHERE id = %s", (client_id,)).fetchone()
    if not client:
        raise HTTPException(status_code=404, detail="API client not found")
    return client


@router.patch("/{client_id}")
def update_api_client(client_id: UUID, payload: ApiClientUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields provided")

    assignments = [f"{field} = %({field})s" for field in data]
    data["client_id"] = client_id
    sql = f"""
        UPDATE api_clients
        SET {", ".join(assignments)}, updated_at = now()
        WHERE id = %(client_id)s
        RETURNING *
    """
    with get_connection() as connection:
        try:
            client = connection.execute(sql, data).fetchone()
        except UniqueViolation:
            raise HTTPException(status_code=409, detail=f"An API client with email '{data.get('email')}' already exists")
    if not client:
        raise HTTPException(status_code=404, detail="API client not found")
    return client
