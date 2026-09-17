import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from app.config import load_backend_env

load_backend_env()


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return database_url


@contextmanager
def get_connection():
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        yield connection


@contextmanager
def get_transaction():
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
