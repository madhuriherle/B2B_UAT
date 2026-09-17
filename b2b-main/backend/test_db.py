import sys
import psycopg
print("psycopg loaded!")

def check_db(port):
    try:
        with psycopg.connect(f"postgresql://postgres:123456@localhost:{port}/postgres") as conn:
            print(f"Connected to port {port}")
    except Exception as e:
        print(f"Failed port {port}: {e}")

check_db(5432)
check_db(5433)
