import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=10)

stdin, stdout, stderr = client.exec_command('ps aux | grep uvicorn')
print("Uvicorn:", stdout.read().decode('utf-8'))

stdin, stdout, stderr = client.exec_command('cat /root/ldb2b-uat/backend/nohup.out | tail -n 50')
print("Nohup:", stdout.read().decode('utf-8'))
