import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

sql_commands = """
CREATE TABLE IF NOT EXISTS loan_document_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_type_id UUID REFERENCES document(doc_id) ON DELETE CASCADE,
    document_category VARCHAR(100),
    document_name VARCHAR(200) NOT NULL,
    description TEXT,
    is_mandatory BOOLEAN DEFAULT false,
    conditional_rule JSONB,
    applicant_type VARCHAR[] DEFAULT '{}',
    verification_method VARCHAR(50) DEFAULT 'manual_upload',
    requires_esign BOOLEAN DEFAULT false,
    allowed_file_types VARCHAR[] DEFAULT '{"pdf", "jpeg", "png"}',
    max_file_size_mb INTEGER DEFAULT 5,
    status BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_loan_doc_update ON loan_document_config;
CREATE TRIGGER trg_loan_doc_update
BEFORE UPDATE ON loan_document_config
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print("Connecting to VPS...")
    client.connect(host, username=user, password=password, timeout=10)
    
    sftp = client.open_sftp()
    with sftp.file('/tmp/create_loan_doc_config.sql', 'w') as f:
        f.write(sql_commands)
    sftp.close()
    
    print("Executing SQL in Prod DB...")
    stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db -f /tmp/create_loan_doc_config.sql')
    
    print("STDOUT:", stdout.read().decode('utf-8'))
    print("STDERR:", stderr.read().decode('utf-8'))
    
except Exception as e:
    print("Error:", e)
finally:
    client.close()
