import paramiko

script = """
import requests
resp = requests.post("http://localhost:8001/api/auth/login", json={"email": "admin@legaldesk.com", "password": "x%EWZm2##V"})
print(resp.status_code)
print(resp.text)
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname="187.127.173.22", username="root", password="Legal@Desk1234567")
stdin, stdout, stderr = client.exec_command(f"python3 -c '{script}'")
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
