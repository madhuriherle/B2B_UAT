from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.b2c_admin.database import Base


class PrintDeliveryStampDenom(Base):
    __tablename__ = "print_delivery_stamp_denom"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    print_delivery_service_id = Column(Integer, ForeignKey("print_delivery_service.id", ondelete="CASCADE"), nullable=False, index=True)
    stamp_denom_id = Column(UUID(as_uuid=True), ForeignKey("stamp_denom.id", ondelete="CASCADE"), nullable=False)
    status = Column(Boolean, nullable=False, default=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    modified_at = Column(DateTime, nullable=True, onupdate=datetime.utcnow)

    service = relationship("PrintDeliveryService", backref="stamp_denoms")
    stamp_denom = relationship("StampDenom", backref="print_delivery_mappings")
