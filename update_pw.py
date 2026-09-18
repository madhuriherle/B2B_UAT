import os
import bcrypt
password = os.environ["NEW_ADMIN_PASSWORD"].encode()
new_hash = bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8')
print("NEW HASH:", new_hash)

import paramiko
sql = f"UPDATE public.users SET password_hash = '{new_hash}' WHERE email = 'admin@legaldesk.com';"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])
stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db')
stdin.write(sql)
stdin.channel.shutdown_write()
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
