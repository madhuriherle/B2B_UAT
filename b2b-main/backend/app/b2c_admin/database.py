import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# This Admin Portal module reads/writes tables owned by a separate B2C
# application that shares this same Postgres database — a second DB client
# library (SQLAlchemy) coexisting with B2B's own psycopg-based
# app.database, both pointed at the same DATABASE_URL. The B2C tables
# (document, user_doc, invoice, state, etc.) already exist live in this
# database; this module never creates or drops them.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/legaldesk_db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
