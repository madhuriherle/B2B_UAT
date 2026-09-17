import os
import secrets
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_admin
from app.config import load_backend_env
from app.database import get_connection, get_transaction

load_backend_env()

router = APIRouter()

ALLOWED_SERVICES = {"eSign", "eKYC", "eStamp"}


class QuotationServiceCreate(BaseModel):
    service_name: str
    service_price: float | None = None
    service_gst_percentage: float = 18
    is_enabled: bool = True


class QuotationCreate(BaseModel):
    organization_id: UUID
    pricing_type: str = "one_time"
    amount: float | None = None
    gst_percentage: float | None = None
    billing_cycle: str | None = None
    quotation_status: str = "sent"
    services: list[QuotationServiceCreate]


def create_token() -> str:
    return secrets.token_hex(24)


@router.get("", dependencies=[Depends(get_current_admin)])
def list_quotations() -> list[dict[str, Any]]:
    sql = """
        SELECT
            q.*,
            o.organization_name,
            o.email AS customer_email,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', qs.id,
                        'service_name', qs.service_name,
                        'service_price', qs.service_price,
                        'service_gst_percentage', qs.service_gst_percentage,
                        'is_enabled', qs.is_enabled
                    )
                ) FILTER (WHERE qs.id IS NOT NULL),
                '[]'
            ) AS services
        FROM quotations q
        JOIN organizations o ON o.id = q.organization_id
        LEFT JOIN quotation_services qs ON qs.quotation_id = q.id
        GROUP BY q.id, o.organization_name, o.email
        ORDER BY q.created_at DESC
    """
    with get_connection() as connection:
        return connection.execute(sql).fetchall()


@router.post("", status_code=201, dependencies=[Depends(get_current_admin)])
def create_quotation(payload: QuotationCreate) -> dict[str, Any]:
    if not payload.services:
        raise HTTPException(status_code=400, detail="services are required")

    invalid_service = next(
        (service.service_name for service in payload.services if service.service_name not in ALLOWED_SERVICES),
        None,
    )
    if invalid_service:
        raise HTTPException(status_code=400, detail="services must be one of eSign, eKYC, eStamp")

    enabled_services = [service for service in payload.services if service.is_enabled]
    subtotal = sum(float(service.service_price or 0) for service in enabled_services)
    if subtotal <= 0:
        raise HTTPException(status_code=400, detail="Enter price for at least one enabled service")

    gst_total = sum(
        float(service.service_price or 0) * float(service.service_gst_percentage or 0) / 100
        for service in enabled_services
    )
    total_amount = subtotal + gst_total
    effective_gst_percentage = (gst_total / subtotal * 100) if subtotal else 0
    quotation_token = create_token()
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    quotation_link = f"{frontend_url}/quote/{quotation_token}"

    with get_transaction() as connection:
        organization = connection.execute(
            """
            SELECT organization_name, email
            FROM organizations
            WHERE id = %s
            """,
            (payload.organization_id,),
        ).fetchone()

        if not organization:
            raise HTTPException(status_code=404, detail="Organization not found")

        quotation = connection.execute(
            """
            INSERT INTO quotations (
                organization_id,
                quotation_token,
                pricing_type,
                amount,
                gst_percentage,
                total_amount,
                billing_cycle,
                quotation_status,
                quotation_link,
                mail_sent
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                payload.organization_id,
                quotation_token,
                payload.pricing_type,
                subtotal,
                effective_gst_percentage,
                total_amount,
                payload.billing_cycle,
                payload.quotation_status,
                quotation_link,
                False,
            ),
        ).fetchone()

        services = []
        for service in payload.services:
            service_row = connection.execute(
                """
                INSERT INTO quotation_services (
                    quotation_id,
                    service_name,
                    service_price,
                    service_gst_percentage,
                    is_enabled
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    quotation["id"],
                    service.service_name,
                    service.service_price,
                    service.service_gst_percentage,
                    service.is_enabled,
                ),
            ).fetchone()
            services.append(service_row)

    quotation["services"] = services
    return quotation


@router.get("/token/{token}")
def get_quotation_by_token(token: str) -> dict[str, Any]:
    sql = """
        SELECT
            q.*,
            o.organization_name,
            o.email AS customer_email,
            o.mobile AS customer_mobile,
            COALESCE(
                json_agg(
                    json_build_object(
                        'service_name', qs.service_name,
                        'service_price', qs.service_price,
                        'service_gst_percentage', qs.service_gst_percentage,
                        'is_enabled', qs.is_enabled
                    )
                ) FILTER (WHERE qs.id IS NOT NULL AND qs.is_enabled = true),
                '[]'
            ) AS services
        FROM quotations q
        JOIN organizations o ON o.id = q.organization_id
        LEFT JOIN quotation_services qs ON qs.quotation_id = q.id
        WHERE q.quotation_token = %s
        GROUP BY q.id, o.organization_name, o.email, o.mobile
    """
    with get_connection() as connection:
        quotation = connection.execute(sql, (token,)).fetchone()

    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return quotation


@router.post("/{quotation_id}/accept")
def accept_quotation(quotation_id: UUID) -> dict[str, Any]:
    with get_transaction() as connection:
        quotation = connection.execute(
            """
            UPDATE quotations
            SET quotation_status = 'accepted', updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (quotation_id,),
        ).fetchone()

        if not quotation:
            raise HTTPException(status_code=404, detail="Quotation not found")

        connection.execute(
            """
            UPDATE customer_service_access
            SET is_active = false
            WHERE organization_id = %s
            """,
            (quotation["organization_id"],),
        )

        services = connection.execute(
            """
            SELECT service_name
            FROM quotation_services
            WHERE quotation_id = %s AND is_enabled = true
            """,
            (quotation["id"],),
        ).fetchall()

        service_access = []
        for service in services:
            access = connection.execute(
                """
                INSERT INTO customer_service_access (
                    organization_id,
                    service_name,
                    is_active,
                    quotation_id
                )
                VALUES (%s, %s, true, %s)
                RETURNING *
                """,
                (quotation["organization_id"], service["service_name"], quotation["id"]),
            ).fetchone()
            service_access.append(access)

    return {"quotation": quotation, "service_access": service_access}
