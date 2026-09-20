import asyncio
from app.database import get_transaction

def init_db():
    with get_transaction() as connection:
        connection.execute("""
        CREATE TABLE IF NOT EXISTS loan_application_drafts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL,
            organization_user_id UUID NOT NULL,
            document_name TEXT NOT NULL,
            form_state JSONB NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            UNIQUE(organization_user_id, document_name)
        );
        """)
        print("Table loan_application_drafts created locally.")

if __name__ == "__main__":
    init_db()
