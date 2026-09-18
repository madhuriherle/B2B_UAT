import os
import paramiko

script = f"""
import requests
resp = requests.post("http://localhost:8001/api/auth/login", json={{"email": "admin@legaldesk.com", "password": "{os.environ["NEW_ADMIN_PASSWORD"]}"}})
print(resp.status_code)
print(resp.text)
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])
stdin, stdout, stderr = client.exec_command(f"python3 -c '{script}'")
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
