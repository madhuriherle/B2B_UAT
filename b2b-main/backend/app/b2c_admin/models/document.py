import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class Document(Base):
    __tablename__ = "document"

    doc_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    doc_name = Column(String, nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("category.category_id"), nullable=False)
    lang = Column(String, nullable=False)

    price = Column(Numeric)
    actual_price = Column(Numeric)

    is_stamp_allowed = Column(Boolean, default=False)
    is_review_required = Column(Boolean, default=False)
    is_notary_allowed = Column(Boolean, default=False)
    esign_allowed = Column(Boolean, default=False)

    payment_status = Column(String, default="pending")
    is_locked = Column(Boolean, default=False)
    status = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
