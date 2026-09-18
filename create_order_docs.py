import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

sql_commands = """
CREATE TABLE IF NOT EXISTS order_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    config_id UUID REFERENCES loan_document_config(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    original_file_name VARCHAR(255),
    verification_status VARCHAR(50) DEFAULT 'pending',
    rejection_reason TEXT,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print("Connecting to VPS...")
    client.connect(host, username=user, password=password, timeout=10)
    
    sftp = client.open_sftp()
    with sftp.file('/tmp/create_order_docs.sql', 'w') as f:
        f.write(sql_commands)
    sftp.close()
    
    print("Executing SQL in UAT DB...")
    client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db_uat -f /tmp/create_order_docs.sql')
    
    print("Executing SQL in Prod DB...")
    client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db -f /tmp/create_order_docs.sql')
    
    print("order_documents table created successfully on both databases!")
except Exception as e:
    print("Error:", e)
finally:
    client.close()
