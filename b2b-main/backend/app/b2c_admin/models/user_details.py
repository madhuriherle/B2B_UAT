import uuid

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class UserDetails(Base):
    __tablename__ = "user_details"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)

    name = Column(String, nullable=False)
    age = Column(Integer)
    mobile = Column(String)
    gender = Column(String)
    country = Column(String)
    state = Column(String)
    city = Column(String)
    zipcode = Column(String)
    address = Column(Text)
    dob = Column(Date)

    status = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime, server_default=func.now())
    modified_by = Column(UUID(as_uuid=True))
    modified_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
