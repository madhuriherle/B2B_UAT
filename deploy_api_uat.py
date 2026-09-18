import paramiko
import os

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

local_base = 'D:/harshithacontinue/b2b-main/b2b-main'
remote_base = '/root/ldb2b-uat'

files_to_sync = [
    ('backend/app/main.py', 'backend/app/main.py'),
    ('backend/app/routes/loan_documents.py', 'backend/app/routes/loan_documents.py')
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Connecting to {host} (UAT)...")
    client.connect(host, username=user, password=password, timeout=10)
    sftp = client.open_sftp()
    
    for local_rel, remote_rel in files_to_sync:
        local_path = os.path.join(local_base, local_rel)
        remote_path = f"{remote_base}/{remote_rel}"
        print(f"Uploading {local_path} -> {remote_path}")
        sftp.put(local_path, remote_path)
        
    sftp.close()
    
    print("Restarting UAT backend service...")
    client.exec_command('pm2 restart all || systemctl restart fastapi || pkill -f uvicorn')
    print("Backend deploy to UAT successful!")

except Exception as e:
    print("Error:", e)
finally:
    client.close()
