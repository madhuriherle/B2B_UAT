import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=10)

stdin, stdout, stderr = client.exec_command('ps aux | grep "[u]vicorn app.main:app.*port 8002"')
pid_line = stdout.read().decode('utf-8').strip()
print("PID Line:", pid_line)
stdin, stdout, stderr = client.exec_command('cat /root/ldb2b-uat/backend/app/routes/loan_documents.py')
print("loan_documents.py:", stdout.read().decode('utf-8'))

stdin, stdout, stderr = client.exec_command('cat /root/ldb2b-uat/backend/app/main.py | grep loan-config')
print("main.py:", stdout.read().decode('utf-8'))

