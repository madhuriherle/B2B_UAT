import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

sql_commands = """
DO $$ 
DECLARE
    new_cat_id uuid;
BEGIN
    -- Insert category and get ID
    INSERT INTO category (category_id, category_name, status, created_by, created_at, modified_at)
    VALUES (gen_random_uuid(), 'Loan Documents', true, 'f778d158-2b76-4cda-9087-507ce2a66be9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING category_id INTO new_cat_id;

    -- Insert documents
    INSERT INTO document (doc_id, doc_name, category_id, lang, doc_type, status, created_by, created_at, modified_at)
    VALUES 
        (gen_random_uuid(), 'Housing Loan', new_cat_id, 'English', 'template', true, 'f778d158-2b76-4cda-9087-507ce2a66be9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (gen_random_uuid(), 'Car Loan', new_cat_id, 'English', 'template', true, 'f778d158-2b76-4cda-9087-507ce2a66be9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (gen_random_uuid(), 'Bike Loan', new_cat_id, 'English', 'template', true, 'f778d158-2b76-4cda-9087-507ce2a66be9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (gen_random_uuid(), 'Personal Loan', new_cat_id, 'English', 'template', true, 'f778d158-2b76-4cda-9087-507ce2a66be9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (gen_random_uuid(), 'Agriculture Loan', new_cat_id, 'English', 'template', true, 'f778d158-2b76-4cda-9087-507ce2a66be9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
END $$;
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print("Connecting...")
    client.connect(host, username=user, password=password, timeout=10)
    
    sftp = client.open_sftp()
    with sftp.file('/tmp/insert_loans_uat.sql', 'w') as f:
        f.write(sql_commands)
    sftp.close()
    
    print("Executing SQL in legaldesk_db_uat...")
    stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db_uat -f /tmp/insert_loans_uat.sql')
    
    print("STDOUT:", stdout.read().decode('utf-8'))
    print("STDERR:", stderr.read().decode('utf-8'))
    
except Exception as e:
    print("Error:", e)
finally:
    client.close()
