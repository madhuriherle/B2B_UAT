"""
Admin Document Templates API
-----------------------------
GET    /api/admin/templates        -> list all templates
GET    /api/admin/templates/{id}   -> single template
POST   /api/admin/templates        -> create
PUT    /api/admin/templates/{id}   -> update
DELETE /api/admin/templates/{id}   -> delete
GET    /api/admin/template-preview/{name} -> render with dummy data

Covers the "Document Templates" tab.
"""

import importlib
import os
import sys
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.document_templates import DocumentTemplate

router = APIRouter(prefix="/api/admin/templates", tags=["admin-templates"])
preview_router = APIRouter(prefix="/api/admin/template-preview", tags=["admin-templates"])


class TemplateCreate(BaseModel):
    document_type: str
    language: str
    template_content: str


class TemplateUpdate(BaseModel):
    document_type: Optional[str] = None
    language: Optional[str] = None
    template_content: Optional[str] = None


@router.get("")
def list_templates(db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    templates = db.query(DocumentTemplate).order_by(DocumentTemplate.id).all()
    return [
        {
            "id": t.id,
            "document_type": t.document_type,
            "language": t.language,
            "preview": (t.template_content[:120] + "...") if len(t.template_content) > 120 else t.template_content,
        }
        for t in templates
    ]


@router.get("/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    t = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"id": t.id, "document_type": t.document_type, "language": t.language, "template_content": t.template_content}


@router.post("", status_code=201)
def create_template(data: TemplateCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    t = DocumentTemplate(document_type=data.document_type, language=data.language, template_content=data.template_content)
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "message": "Template created"}


@router.put("/{template_id}")
def update_template(template_id: int, data: TemplateUpdate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    t = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    if data.document_type is not None:
        t.document_type = data.document_type
    if data.language is not None:
        t.language = data.language
    if data.template_content is not None:
        t.template_content = data.template_content

    db.commit()
    db.refresh(t)
    return {"id": t.id, "message": "Template updated"}


def _render_preview(template_name: str) -> str:
    dummy_data = {
        "old_name": "Ramesh Kumar",
        "new_name": "Ramesh Kumar Sharma",
        "guardian_name": "Suresh Kumar",
        "age": "35",
        "gender": "Male",
        "address": "123, MG Road, Bengaluru, Karnataka, India - 560001",
        "date": "24-04-2026",
        "date_of_birth": "01-01-1990",
        "reason": "Personal preference and family tradition",
        "document_name": "Aadhaar Card",
        "state": "Karnataka",
        "landlords": [{"name": "Suresh Kumar", "age": "55", "address": "456, Park Street, Bengaluru"}],
        "tenants": [{"name": "Ramesh Kumar", "age": "35", "address": "789, Church Road, Bengaluru"}],
        "property": {"address": "101, MG Road, Bengaluru", "type": "2BHK Apartment"},
        "agreement": {"start_date": "01-05-2026", "end_date": "30-04-2027", "duration": "12 months"},
        "rental_details": {"monthly_rent": "15000", "deposit": "45000", "advance": "30000"},
    }

    templates_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "templates_py"))
    available = [f[:-3] for f in os.listdir(templates_dir) if f.endswith(".py") and not f.startswith("__")]

    matched = template_name if template_name in available else None
    if not matched:
        for name in available:
            if template_name.lower() in name.lower():
                matched = name
                break

    if not matched:
        raise HTTPException(status_code=404, detail=f"Template '{template_name}' not found. Available: {available}")

    module_name = f"app.b2c_admin.templates_py.{matched}"
    try:
        if module_name in sys.modules:
            del sys.modules[module_name]
        mod = importlib.import_module(module_name)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail=f"Could not import template '{matched}'")

    render_fn = None
    for attr in dir(mod):
        if attr.startswith("render"):
            render_fn = getattr(mod, attr)
            break

    if render_fn is None:
        raise HTTPException(status_code=404, detail="No render function found in template")

    try:
        return render_fn(dummy_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Render error: {str(e)}")


@preview_router.get("/{template_name}")
@router.get("/preview/{template_name}")
def preview_template(template_name: str, current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    html_body = _render_preview(template_name)
    full_html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>body {{ margin:0; padding:0; font-family: Georgia, serif; }}</style>
</head>
<body>{html_body}</body>
</html>"""
    return HTMLResponse(content=full_html)


@router.delete("/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    t = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(t)
    db.commit()
    return {"message": "Template deleted"}
