from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class Invoice(Base):
    __tablename__ = "invoice"

    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String(20), unique=True, nullable=False)
    user_doc_id = Column(Integer, ForeignKey("user_doc.user_doc_id"), nullable=False)
    payment_transaction_id = Column(Integer, ForeignKey("payment_transaction.id"), nullable=True)
    generated_by = Column(UUID(as_uuid=True), nullable=True)
    generated_at = Column(DateTime, server_default=func.now())
    status = Column(Boolean, default=True)
