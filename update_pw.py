import bcrypt
password = b"x%EWZm2##V"
new_hash = bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8')
print("NEW HASH:", new_hash)

import paramiko
sql = f"UPDATE public.users SET password_hash = '{new_hash}' WHERE email = 'admin@legaldesk.com';"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname="187.127.173.22", username="root", password="Legal@Desk1234567")
stdin, stdout, stderr = client.exec_command('PGPASSWORD=password psql -h localhost -U postgres -d legaldesk_db')
stdin.write(sql)
stdin.channel.shutdown_write()
print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
