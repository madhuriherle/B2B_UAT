from sqlalchemy import Column, Integer, String, Text

from app.b2c_admin.database import Base


class DocumentTemplate(Base):
    __tablename__ = "document_templates"

    id = Column(Integer, primary_key=True, index=True)
    document_type = Column(String, nullable=False)
    language = Column(String, nullable=False)
    template_content = Column(Text, nullable=False)
