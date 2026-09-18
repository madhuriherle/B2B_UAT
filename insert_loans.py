import os
import paramiko

sql = """
DO $$
DECLARE
    cat_id uuid := gen_random_uuid();
    admin_id uuid := 'f778d158-2b76-4cda-9087-507ce2a66be9';
BEGIN
    INSERT INTO category (category_id, category_name, status, created_by, created_at, modified_at)
    VALUES (cat_id, 'Loan Documents', true, admin_id, now(), now());

    INSERT INTO document (doc_id, doc_name, category_id, lang, doc_type, status, created_by, created_at, modified_at, is_stamp_allowed, is_review_required, is_notary_allowed, esign_allowed)
    VALUES 
        (gen_random_uuid(), 'Housing Loan', cat_id, 'English', 'template', true, admin_id, now(), now(), false, false, false, true),
        (gen_random_uuid(), 'Car Loan', cat_id, 'English', 'template', true, admin_id, now(), now(), false, false, false, true),
        (gen_random_uuid(), 'Bike Loan', cat_id, 'English', 'template', true, admin_id, now(), now(), false, false, false, true),
        (gen_random_uuid(), 'Personal Loan', cat_id, 'English', 'template', true, admin_id, now(), now(), false, false, false, true),
        (gen_random_uuid(), 'Agriculture Loan', cat_id, 'English', 'template', true, admin_id, now(), now(), false, false, false, true);
END $$;
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])

sftp = client.open_sftp()
with sftp.file('/tmp/insert.sql', 'w') as f:
    f.write(sql)
sftp.close()

stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db -f /tmp/insert.sql')

print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
