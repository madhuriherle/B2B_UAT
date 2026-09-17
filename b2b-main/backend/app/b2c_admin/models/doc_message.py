from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.b2c_admin.database import Base


class DocMessage(Base):
    __tablename__ = "doc_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_doc_id = Column(Integer, ForeignKey("user_doc.user_doc_id"), nullable=False, index=True)
    sender_type = Column(String(10), nullable=False)  # 'system' | 'admin' | 'user'
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
