import os
import paramiko

# Applies the new LOAN APPLICATIONS section (7 tables) appended to the end
# of backend/db/schema.sql — extracted live from the file rather than
# duplicated here, so this always applies exactly what's in source control.
# Mirrors the SSH+psql pattern already used by create_table_uat.py.

SCHEMA_PATH = "D:/harshithacontinue/b2b-main/b2b-main/backend/db/schema.sql"
MARKER = "-- LOAN APPLICATIONS"

with open(SCHEMA_PATH, encoding="utf-8") as f:
    schema_sql = f.read()

marker_index = schema_sql.index(MARKER)
# Back up to the start of the preceding "-- =========...=========" banner
# line so the applied SQL includes the section header comment too.
banner_index = schema_sql.rindex("-- =========================================", 0, marker_index)
sql_commands = schema_sql[banner_index:]

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Connecting to {host}...")
    client.connect(host, username=user, password=password, timeout=10)

    sftp = client.open_sftp()
    with sftp.file("/tmp/create_loan_application_tables.sql", "wb") as f:
        f.write(sql_commands.encode("utf-8"))
    sftp.close()

    print("Applying LOAN APPLICATIONS tables (CREATE TABLE IF NOT EXISTS — additive only, no drops)...")
    stdin, stdout, stderr = client.exec_command(
        f'PGPASSWORD={os.environ["PG_PASSWORD"]} PGCLIENTENCODING=UTF8 psql -h localhost -U postgres -d legaldesk_db '
        f'-f /tmp/create_loan_application_tables.sql'
    )
    print("STDOUT:", stdout.read().decode("utf-8"))
    print("STDERR:", stderr.read().decode("utf-8"))

except Exception as e:
    print("Error:", e)
finally:
    client.close()
