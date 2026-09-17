import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class SupportRequest(Base):
    __tablename__ = "support_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    user_doc_id = Column(ForeignKey("user_doc.user_doc_id"), nullable=True)
    message = Column(Text, nullable=False)
    status = Column(String(20), default="open")  # open | resolved
    created_at = Column(DateTime(timezone=True), server_default=func.now())
