import paramiko
import os
import posixpath
import sys

HOST = "187.127.173.22"
USER = "root"
PASSWORD = "Legal@Desk1234567"

LOCAL_FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "b2b-main", "frontend", "B2B LD", "dist")
REMOTE_FRONTEND = "/var/www/legaldesk-b2b-uat"

LOCAL_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "b2b-main", "backend")
REMOTE_BACKEND = "/root/ldb2b-uat/backend"

SKIP_DIRS = {"__pycache__", ".git", "node_modules", "venv", ".pytest_cache", "uploads"}
SKIP_EXTS = {".pyc", ".pyo"}


def should_skip(relpath, name):
    if name in SKIP_DIRS:
        return True
    ext = os.path.splitext(name)[1]
    return ext in SKIP_EXTS


def upload_dir(sftp, local, remote):
    entries = os.listdir(local)
    for entry in entries:
        if should_skip(entry, entry):
            continue
        local_path = os.path.join(local, entry)
        remote_path = posixpath.join(remote, entry)
        if os.path.isdir(local_path):
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                sftp.mkdir(remote_path)
            upload_dir(sftp, local_path, remote_path)
        else:
            sftp.put(local_path, remote_path)
            print(f"  UP  {remote_path}")


def main(section):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = client.open_sftp()

    try:
        if section in ("frontend", "all"):
            print("=== Uploading FRONTEND ===")
            upload_dir(sftp, LOCAL_FRONTEND, REMOTE_FRONTEND)
        if section in ("backend", "all"):
            print("=== Uploading BACKEND (app + db) ===")
            upload_dir(sftp, os.path.join(LOCAL_BACKEND, "app"), posixpath.join(REMOTE_BACKEND, "app"))
            upload_dir(sftp, os.path.join(LOCAL_BACKEND, "db"), posixpath.join(REMOTE_BACKEND, "db"))
    finally:
        sftp.close()

    if section in ("backend", "all"):
        print("=== Restarting service ===")
        stdin, stdout, stderr = client.exec_command("systemctl restart legaldeskb2b-uat.service && sleep 2 && systemctl is-active legaldeskb2b-uat.service")
        print(stdout.read().decode().strip())
        err = stderr.read().decode().strip()
        if err:
            print("STDERR:", err)

    client.close()
    print("DONE")


if __name__ == "__main__":
    section = sys.argv[1] if len(sys.argv) > 1 else "all"
    main(section)