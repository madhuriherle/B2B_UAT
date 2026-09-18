import os
import sys
import paramiko

# Verification for the multi-party Loan Application DB persistence.
# Same SSH + psql pattern as apply_loan_application_tables.py:
#   - targets UAT (legaldesk_db_uat) by default; pass "--prod" to check legaldesk_db
#   - optional 2nd arg = order_no to restrict to one application (e.g. ORD-000039)
# Shows the latest applications, their parties, and every repeatable-row section.

target_db = "legaldesk_db_uat"
order_filter = None
for arg in sys.argv[1:]:
    if arg == "--prod":
        target_db = "legaldesk_db"
    else:
        order_filter = arg

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

def run_psql(sql):
    sql = sql.replace("\\", "\\\\")
    stdin, stdout, stderr = client.exec_command(
        f'PGPASSWORD={os.environ["PG_PASSWORD"]} psql -h localhost -U postgres -d {target_db} '
        f'-P pager=off -F " | " -A -c "{sql}"'
    )
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace").strip()
    return out, err

try:
    print(f"Connecting to {host} ({target_db})...")
    client.connect(host, username=user, password=password, timeout=15)

    limit_clause = f"WHERE o.order_no = '{order_filter}'" if order_filter else "ORDER BY a.created_at DESC LIMIT 3 OFFSET 0"

    sql_apps = f"""
        SELECT a.id::text, o.order_no, a.loan_type_document_name, a.loan_amount,
               a.tenure_months, a.interest_rate, a.created_at
        FROM loan_applications a
        JOIN orders o ON o.id = a.order_id
        {limit_clause}
    """
    if order_filter:
        sql_apps = sql_apps.replace("ORDER BY a.created_at DESC LIMIT 3 OFFSET 0", "")

    out, err = run_psql(sql_apps)
    print("=== loan_applications ===")
    print(out)
    if err:
        print("ERR:", err)

    sql_count_check = f"""
        SELECT
          (SELECT count(*) FROM loan_applications),
          (SELECT count(*) FROM loan_application_parties),
          (SELECT count(*) FROM loan_application_party_income),
          (SELECT count(*) FROM loan_application_party_existing_loans),
          (SELECT count(*) FROM loan_application_party_bank_accounts),
          (SELECT count(*) FROM loan_application_party_assets),
          (SELECT count(*) FROM loan_application_party_references)
    """
    out, err = run_psql(sql_count_check)
    print("=== total rows (apps, parties, income, existing_loans, bank_accounts, assets, references) ===")
    print(out)
    if err:
        print("ERR:", err)

    if order_filter:
        subquery = f"WHERE a.order_id = (SELECT id FROM orders WHERE order_no = '{order_filter}')"
    else:
        subquery = "WHERE a.id = (SELECT id FROM loan_applications ORDER BY created_at DESC LIMIT 1)"

    sql_parties = f"""
        SELECT p.id::text, p.role, p.full_name, p.gender, p.date_of_birth, p.marital_status,
               p.pan_number, p.aadhaar_number, p.occupation, p.monthly_income,
               p.present_address->>'mobile' AS mobile, p.present_address->>'email' AS email,
               p.present_address->>'district' AS district, p.present_address->>'state' AS state
        FROM loan_application_parties p
        WHERE p.loan_application_id IN (SELECT id FROM loan_applications a {subquery})
        ORDER BY p.created_at, p.full_name
    """
    out, err = run_psql(sql_parties)
    print("=== parties of latest / filtered application ===")
    print(out)
    if err:
        print("ERR:", err)

    for section, table in [
        ("income", "loan_application_party_income"),
        ("existing loans", "loan_application_party_existing_loans"),
        ("bank accounts", "loan_application_party_bank_accounts"),
        ("assets", "loan_application_party_assets"),
        ("references", "loan_application_party_references"),
    ]:
        out, err = run_psql(f"SELECT * FROM {table} ORDER BY created_at DESC LIMIT 15")
        print(f"=== {section} (latest 15 rows of {table}) ===")
        print(out)
        if err:
            print("ERR:", err)

except Exception as e:
    print("Error:", e)
finally:
    client.close()