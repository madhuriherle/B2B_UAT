import paramiko
import sys

def run_ssh(host, username, password, command):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname=host, username=username, password=password, timeout=10)
        stdin, stdout, stderr = client.exec_command(command)
        out = stdout.read().decode('utf-8')
        err = stderr.read().decode('utf-8')
        print(out)
        if err:
            print("ERROR:")
            print(err)
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        run_ssh("187.127.173.22", "root", "Legal@Desk1234567", cmd)
