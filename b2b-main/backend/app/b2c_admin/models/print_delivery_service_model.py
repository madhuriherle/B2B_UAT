from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.b2c_admin.database import Base


class PrintDeliveryService(Base):
    __tablename__ = "print_delivery_service"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    state_id = Column(UUID(as_uuid=True), ForeignKey("state.id", ondelete="CASCADE"), nullable=False, index=True)
    document_type = Column(String(100), nullable=True)
    service_charge = Column(Numeric(10, 2), nullable=False, default=0)
    per_copy_price = Column(Numeric(10, 2), default=0)
    esign_price = Column(Numeric(10, 2), default=0)
    enotary_price = Column(Numeric(10, 2), default=0)
    status = Column(Boolean, nullable=False, default=True)

    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    modified_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    state = relationship("State", backref="print_delivery_services")
