import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=10)

stdin, stdout, stderr = client.exec_command('cd "/root/ldb2b-uat/frontend/B2B LD" && npm run build:uat')
with open("build_err.txt", "wb") as f:
    f.write(stderr.read())
print("Saved to build_err.txt")
out = stdout.read()
try:
    print(out.decode('utf-8'))
except:
    print("Cannot decode stdout")
