import os
import paramiko
import sys

sql = """
INSERT INTO public.users VALUES ('6cf904bc-410f-4706-be56-6a318dd7ad50', 'admin@legaldesk.com', '$2b$12$L1FJPJu0iFYopWVZP3xY5.Xa9UMCOqkFg9beEItye3Qz9RnbbblmO', 'Super Admin', true, '2026-08-31 10:35:27.007205', '2026-09-07 07:15:08.575846', NULL, NULL, 'admin', NULL, NULL, NULL, false, NULL, NULL, 0);
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])
stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db')
stdin.write(sql)
stdin.channel.shutdown_write()

print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
