import uuid

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class State(Base):
    __tablename__ = "state"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    state_name = Column(String, nullable=False, unique=True)
    language_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
