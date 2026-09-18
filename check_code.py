import os
import paramiko

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(host, username=user, password=password, timeout=10)
    stdin, stdout, stderr = client.exec_command('grep -A 5 "LoanDocumentFlow" "/root/ldb2b-uat/frontend/B2B LD/src/pages/partner-user/PartnerUserCreateOrder.jsx"')
    print(stdout.read().decode('utf-8'))
except Exception as e:
    print("Error:", e)
finally:
    client.close()
