import os
import bcrypt
hash_val = os.environ["ADMIN_PASSWORD_HASH"].encode()
password = os.environ["NEW_ADMIN_PASSWORD"].encode()
print("Match:", bcrypt.checkpw(password, hash_val))
