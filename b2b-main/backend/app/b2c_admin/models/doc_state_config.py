import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.mutable import MutableList
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class DocStateConfig(Base):
    __tablename__ = "doc_state_config"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    doc_id = Column(UUID(as_uuid=True), ForeignKey("document.doc_id"), nullable=False)
    state_id = Column(UUID(as_uuid=True), ForeignKey("state.id"), nullable=False)

    english_enabled = Column(Boolean, default=True)
    actual_price = Column(Numeric, nullable=True)
    offer_price = Column(Numeric, nullable=True)
    # Stores a list of stamp denominations e.g. [100, 500]
    stamp_denominations = Column(MutableList.as_mutable(JSONB), nullable=True, default=list)
    notary_price = Column(Numeric, nullable=True)
    esign_price = Column(Numeric, nullable=True)

    is_active = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
