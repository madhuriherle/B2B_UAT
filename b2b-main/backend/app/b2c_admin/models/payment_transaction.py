from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class PaymentTransaction(Base):
    __tablename__ = "payment_transaction"

    id = Column(Integer, primary_key=True, index=True)

    user_doc_id = Column(Integer, ForeignKey("user_doc.user_doc_id"), nullable=False)

    doc_price = Column(Numeric, nullable=False)

    cgst = Column(Numeric)
    sgst = Column(Numeric)
    igst = Column(Numeric)

    cgst_value = Column(Numeric)
    sgst_value = Column(Numeric)
    igst_value = Column(Numeric)

    transaction_datetime = Column(DateTime, nullable=False)

    status = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
