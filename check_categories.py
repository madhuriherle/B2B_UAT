import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(host, username=user, password=password, timeout=10)
    stdin, stdout, stderr = client.exec_command(f"PGPASSWORD={os.environ['PG_PASSWORD']} psql -h localhost -U postgres -d legaldesk_db_uat -c 'SELECT * FROM category;'")
    print(stdout.read().decode('utf-8'))
except Exception as e:
    print("Error:", e)
finally:
    client.close()
