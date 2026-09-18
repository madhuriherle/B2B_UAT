import paramiko
import os
import shutil

host = os.environ["VPS_HOST"]
user = os.environ.get("VPS_USER", "root")
password = os.environ["VPS_PASSWORD"]

local_base = 'D:/harshithacontinue/b2b-main/b2b-main'
remote_base = '/root/ldb2b-uat'

import zipfile

def zip_dir(dir_path, zip_path, exclude_dirs):
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(dir_path):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, dir_path)
                zipf.write(file_path, arcname)

def deploy():
    print("Zipping local frontend and backend folders (excluding node_modules)...")
    exclude = {'node_modules', 'dist', '__pycache__', '.venv', 'venv'}
    
    zip_dir(os.path.join(local_base, 'backend'), 'backend_upload.zip', exclude)
    zip_dir(os.path.join(local_base, 'frontend/B2B LD'), 'frontend_upload.zip', exclude)
    
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        print("Connecting to VPS...")
        client.connect(host, username=user, password=password, timeout=10)
        sftp = client.open_sftp()
        
        print("Uploading backend zip...")
        sftp.put('backend_upload.zip', '/tmp/backend_upload.zip')
        
        print("Uploading frontend zip...")
        sftp.put('frontend_upload.zip', '/tmp/frontend_upload.zip')
        sftp.close()
        
        print("Extracting backend on server...")
        client.exec_command(f'unzip -o /tmp/backend_upload.zip -d {remote_base}/backend && rm /tmp/backend_upload.zip')
        
        print("Extracting frontend on server...")
        client.exec_command(f'unzip -o /tmp/frontend_upload.zip -d "{remote_base}/frontend/B2B LD" && rm /tmp/frontend_upload.zip')
        
        print("Restarting Backend...")
        client.exec_command('pm2 restart all || systemctl restart fastapi || pkill -f uvicorn')
        
        print("Building Frontend (this takes a minute)...")
        stdin, stdout, stderr = client.exec_command(f'cd "{remote_base}/frontend/B2B LD" && npm run build:uat')
        exit_status = stdout.channel.recv_exit_status()
        
        if exit_status == 0:
            print("Build successful, copying to Nginx root...")
            client.exec_command(f'cp -r "{remote_base}/frontend/B2B LD/dist/"* /var/www/legaldesk-b2b-uat/')
            print("FULL DEPLOYMENT SUCCESSFUL!")
        else:
            print("Build failed!")
            with open("build_err.txt", "wb") as f:
                f.write(stderr.read())
            print("Check build_err.txt for details.")
            
    except Exception as e:
        print("Error:", e)
    finally:
        client.close()
        # Clean up local zips
        if os.path.exists('backend_upload.zip'): os.remove('backend_upload.zip')
        if os.path.exists('frontend_upload.zip'): os.remove('frontend_upload.zip')

if __name__ == '__main__':
    deploy()
