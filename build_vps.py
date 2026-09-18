import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Connecting to {host}...")
    client.connect(host, username=user, password=password, timeout=10)
    
    print("Running frontend build...")
    stdin, stdout, stderr = client.exec_command('cd "/root/ldb2b/frontend/B2B LD" && npm run build')
    
    print("STDOUT:", stdout.read().decode('utf-8'))
    print("STDERR:", stderr.read().decode('utf-8'))
    
except Exception as e:
    print("Error:", e)
finally:
    client.close()
