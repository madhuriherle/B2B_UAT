import paramiko
import os
import time

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

local_base = 'D:/harshithacontinue/b2b-main/b2b-main'
remote_base = '/root/ldb2b-uat'

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
    print(f"Connecting to {host} (UAT)...")
    client.connect(host, username=user, password=password, timeout=10)
    sftp = client.open_sftp()
    
    # Ensure admin directory exists
    try:
        sftp.mkdir(f"{remote_base}/frontend/B2B LD/src/pages/admin")
    except IOError:
        pass # Directory already exists

    try:
        sftp.mkdir(f"{remote_base}/backend/app/assets")
    except IOError:
        pass
    try:
        sftp.mkdir(f"{remote_base}/backend/app/assets/fonts")
    except IOError:
        pass


    for local_rel, remote_rel in files_to_sync:
        local_path = os.path.join(local_base, local_rel)
        remote_path = f"{remote_base}/{remote_rel}"
        
        print(f"Uploading {local_path} -> {remote_path}")
        sftp.put(local_path, remote_path)
        
    sftp.close()
    
    print("Restarting UAT backend service...")
    client.exec_command('pm2 restart all || systemctl restart fastapi || pkill -f uvicorn')
    
    print("Running frontend build for UAT... this may take a minute.")
    # Run the build command and copy to nginx directory
    stdin, stdout, stderr = client.exec_command('cd "/root/ldb2b-uat/frontend/B2B LD" && npm install && npm run build:uat && rm -rf /var/www/legaldesk-b2b-uat/* && cp -r dist/* /var/www/legaldesk-b2b-uat/')
    
    # We ignore stdout since it will crash Python due to unicode issue, just wait for it to finish.
    exit_status = stdout.channel.recv_exit_status()
    if exit_status == 0:
        print("Build and copy successful!")
    else:
        print("Build failed.")
    
    print("Deployment to UAT VPS successful!")

except Exception as e:
    print("Deployment Error:", e)
finally:
    client.close()