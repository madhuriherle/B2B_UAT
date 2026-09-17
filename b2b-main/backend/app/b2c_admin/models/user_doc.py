from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.sql import func

from app.b2c_admin.database import Base

# doc_status: draft | completed | generated | paid
# payment_status: pending | success | failed
# doc_state: initiated | in_review | awaiting_payment | completed


class UserDoc(Base):
    __tablename__ = "user_doc"

    user_doc_id = Column(Integer, primary_key=True, index=True)

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("document.doc_id"), nullable=False)
    state_id = Column(UUID(as_uuid=True), ForeignKey("state.id"))

    price = Column(Numeric, nullable=False)

    coupon_id = Column(UUID(as_uuid=True), ForeignKey("coupon.coupon_id"))
    discount_coupon = Column(Numeric)

    form_data = Column(MutableDict.as_mutable(JSONB), default=dict)
    generated_content = Column(Text, nullable=True)
    current_field = Column(String(100), nullable=True)
    completed_fields = Column(JSONB, default=list)

    # Snapshot at payment time so later price changes don't affect history
    pricing = Column(JSONB, nullable=True)

    doc_status = Column(String(20), default="draft")
    doc_state = Column(String(30), default="initiated")
    payment_status = Column(String(20), default="pending")

    is_paid = Column(Boolean, default=False)

    payment_id = Column(String(100), nullable=True)
    order_id = Column(String(100), nullable=True)
    amount_paid = Column(Numeric, nullable=True)
    currency = Column(String(10), default="INR")

    created_date = Column(DateTime, server_default=func.now())
    last_update = Column(DateTime, server_default=func.now(), onupdate=func.now())
    paid_date = Column(DateTime)

    esign_opted = Column(Boolean, default=False)
    note = Column(String(500))
    status = Column(Boolean, default=True)

    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
