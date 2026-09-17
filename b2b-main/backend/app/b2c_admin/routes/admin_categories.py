from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.b2c_admin.database import get_db
from app.b2c_admin.deps import get_current_b2c_admin
from app.b2c_admin.models.category import Category
from app.b2c_admin.schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate

router = APIRouter(prefix="/api/admin/categories", tags=["admin-categories"])


@router.get("", response_model=List[CategoryResponse])
def get_categories(db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    return db.query(Category).all()


@router.post("", response_model=CategoryResponse)
def create_category(data: CategoryCreate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    if db.query(Category).filter(Category.category_name.ilike(data.category_name)).first():
        raise HTTPException(status_code=400, detail="Category already exists")

    category = Category(category_name=data.category_name, created_by=current_user["id"])
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.put("/{category_id}", response_model=CategoryResponse)
def update_category(category_id: UUID, data: CategoryUpdate, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    category = db.query(Category).filter(Category.category_id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if data.category_name is not None:
        if db.query(Category).filter(Category.category_name.ilike(data.category_name), Category.category_id != category_id).first():
            raise HTTPException(status_code=400, detail="Category already exists")
        category.category_name = data.category_name

    if data.status is not None:
        category.status = data.status

    category.modified_by = current_user["id"]
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}")
def delete_category(category_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    category = db.query(Category).filter(Category.category_id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    db.delete(category)
    db.commit()
    return {"message": "Category deleted successfully"}


@router.get("/{category_id}", response_model=CategoryResponse)
def get_category_by_id(category_id: UUID, db: Session = Depends(get_db), current_user: dict[str, Any] = Depends(get_current_b2c_admin)):
    category = db.query(Category).filter(Category.category_id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category
