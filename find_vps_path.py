import os
import paramiko
import sys

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Connecting to {host}...")
    client.connect(host, username=user, password=password, timeout=10)
    
    print("Running command...")
    stdin, stdout, stderr = client.exec_command('find / -name "PartnerUserCreateOrder.jsx" 2>/dev/null')
    
    output = stdout.read().decode('utf-8')
    err = stderr.read().decode('utf-8')
    
    print("STDOUT:", output)
    print("STDERR:", err)
    
except Exception as e:
    print("Error:", e)
finally:
    client.close()
