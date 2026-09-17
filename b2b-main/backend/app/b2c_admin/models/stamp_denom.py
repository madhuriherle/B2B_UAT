import uuid

from sqlalchemy import Boolean, Column, DateTime, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class StampDenom(Base):
    __tablename__ = "stamp_denom"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    denomvalue = Column(Numeric, nullable=False)
    status = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
