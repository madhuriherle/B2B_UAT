import os
import paramiko
sql = "UPDATE public.users SET password_hash = '$2b$12$iS6.SoYvblWiVqTVuHGVHe2eC.l7Qcq8YbYi2YfZ66ZYvC9uKngC6' WHERE email = 'admin@legaldesk.com';"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])
stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db_uat')
stdin.write(sql)
stdin.channel.shutdown_write()
print("STDOUT:", stdout.read().decode())
client.close()
