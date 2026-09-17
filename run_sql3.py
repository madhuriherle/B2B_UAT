import paramiko
sql = "\\d users;"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname="187.127.173.22", username="root", password="Legal@Desk1234567")
stdin, stdout, stderr = client.exec_command('PGPASSWORD=password psql -h localhost -U postgres -d legaldesk_db')
stdin.write(sql)
stdin.channel.shutdown_write()
print("STDOUT:", stdout.read().decode())
client.close()
