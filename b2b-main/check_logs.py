import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('187.127.173.22', username='root', password='Legal@Desk1234567', timeout=10)
# Verify the fix was applied
stdin, stdout, stderr = client.exec_command('grep -A3 "client_max_body_size" /etc/nginx/sites-enabled/uat.legaldesk.com')
print(stdout.read().decode())
client.close()
