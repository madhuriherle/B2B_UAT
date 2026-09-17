import paramiko
import sys

sql = "UPDATE public.users SET password_hash = '$2b$12$iS6.SoYvblWiVqTVuHGVHe2eC.l7Qcq8YbYi2YfZ66ZYvC9uKngC6' WHERE email = 'admin@legaldesk.com';"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname="187.127.173.22", username="root", password="Legal@Desk1234567")
stdin, stdout, stderr = client.exec_command('PGPASSWORD=password psql -h localhost -U postgres -d legaldesk_db')
stdin.write(sql)
stdin.channel.shutdown_write()

print("STDOUT:", stdout.read().decode())
print("STDERR:", stderr.read().decode())
client.close()
