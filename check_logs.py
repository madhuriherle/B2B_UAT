import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=10)

stdin, stdout, stderr = client.exec_command('journalctl -u fastapi -n 50 --no-pager')
out = stdout.read().decode('utf-8')
if "No entries" in out or not out.strip():
    stdin, stdout, stderr = client.exec_command('pm2 logs --lines 50 --nostream')
    out = stdout.read().decode('utf-8') + "\nSTDERR:\n" + stderr.read().decode('utf-8')
print(out)
