import paramiko
import os

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

local_base = 'D:/harshithacontinue/b2b-main/b2b-main'
remote_base = '/root/ldb2b'

files_to_sync = [
    ('backend/app/routes/partner_user.py', 'backend/app/routes/partner_user.py'),
    ('backend/app/routes/partner.py', 'backend/app/routes/partner.py'),
    ('backend/app/main.py', 'backend/app/main.py'),
    ('backend/app/esign_service.py', 'backend/app/esign_service.py'),
    ('backend/app/routes/document_service.py', 'backend/app/routes/document_service.py'),
    ('backend/app/routes/loan_documents.py', 'backend/app/routes/loan_documents.py'),
    ('backend/app/loan_i18n.py', 'backend/app/loan_i18n.py'),
    ('backend/app/assets/fonts/NotoSansDevanagari-Regular.ttf', 'backend/app/assets/fonts/NotoSansDevanagari-Regular.ttf'),
    ('backend/app/assets/fonts/NotoSansDevanagari-Bold.ttf', 'backend/app/assets/fonts/NotoSansDevanagari-Bold.ttf'),
    ('backend/app/assets/fonts/NotoSansKannada-Regular.ttf', 'backend/app/assets/fonts/NotoSansKannada-Regular.ttf'),
    ('backend/app/assets/fonts/NotoSansKannada-Bold.ttf', 'backend/app/assets/fonts/NotoSansKannada-Bold.ttf'),
    ('frontend/B2B LD/src/pages/partner-user/PartnerUserCreateOrder.jsx', 'frontend/B2B LD/src/pages/partner-user/PartnerUserCreateOrder.jsx'),
    ('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx'),
    ('frontend/B2B LD/src/App.jsx', 'frontend/B2B LD/src/App.jsx'),
    ('frontend/B2B LD/src/components/Sidebar.jsx', 'frontend/B2B LD/src/components/Sidebar.jsx'),
    ('frontend/B2B LD/index.html', 'frontend/B2B LD/index.html'),
    ('frontend/B2B LD/public/favicon.png', 'frontend/B2B LD/public/favicon.png')
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Connecting to {host} (PROD B2B)...")
    client.connect(host, username=user, password=password, timeout=10)
    sftp = client.open_sftp()

    for d in ('backend/app/assets', 'backend/app/assets/fonts', 'frontend/B2B LD/src/pages/admin'):
        try:
            sftp.mkdir(f"{remote_base}/{d}")
        except IOError:
            pass

    for local_rel, remote_rel in files_to_sync:
        local_path = os.path.join(local_base, local_rel)
        remote_path = f"{remote_base}/{remote_rel}"
        print(f"Uploading {local_rel} -> {remote_rel}")
        sftp.put(local_path, remote_path)

    sftp.close()

    print("Restarting PROD B2B backend service (legaldeskb2b.service)...")
    stdin, stdout, stderr = client.exec_command('systemctl restart legaldeskb2b.service; sleep 3; systemctl is-active legaldeskb2b.service')
    print("ACTIVE:", stdout.read().decode('utf-8'))
    print("ERR:", stderr.read().decode('utf-8'))

    print("Building PROD frontend (base /b2b/)... this may take a minute.")
    stdin, stdout, stderr = client.exec_command('cd "/root/ldb2b/frontend/B2B LD" && npm install && npm run build && rm -rf /var/www/legaldesk-b2b/* && cp -r dist/* /var/www/legaldesk-b2b/')
    exit_status = stdout.channel.recv_exit_status()
    print("BUILD EXIT STATUS:", exit_status)
    err = stderr.read().decode('utf-8', 'replace')
    tail = err.splitlines()[-30:] if exit_status != 0 else ['(build ok)']
    print("\n".join(tail))
    print("Deployment to PROD B2B VPS successful!" if exit_status == 0 else "BUILD FAILED - see tail above.")

except Exception as e:
    print("Deployment Error:", e)
finally:
    client.close()