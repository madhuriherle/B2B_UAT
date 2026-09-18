import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])
stdin, stdout, stderr = client.exec_command(f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d legaldesk_db -c "SELECT * FROM category LIMIT 10;"')

print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
