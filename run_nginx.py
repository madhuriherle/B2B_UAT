import os
import paramiko

cmd = "cat /etc/nginx/sites-enabled/default || cat /etc/nginx/conf.d/*.conf"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname=os.environ["VPS_HOST"], username=os.environ.get("VPS_USER", "root"), password=os.environ["VPS_PASSWORD"])
stdin, stdout, stderr = client.exec_command(cmd)
print("STDOUT:", stdout.read().decode())
client.close()
