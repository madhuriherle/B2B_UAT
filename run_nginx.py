import paramiko

cmd = "cat /etc/nginx/sites-enabled/default || cat /etc/nginx/conf.d/*.conf"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname="187.127.173.22", username="root", password="Legal@Desk1234567")
stdin, stdout, stderr = client.exec_command(cmd)
print("STDOUT:", stdout.read().decode())
client.close()
