import uuid

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class Category(Base):
    __tablename__ = "category"

    category_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_name = Column(String, nullable=False, unique=True)
    status = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
