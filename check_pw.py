import bcrypt
hash_val = b"$2b$12$L1FJPJu0iFYopWVZP3xY5.Xa9UMCOqkFg9beEItye3Qz9RnbbblmO"
password = b"x%EWZm2##V"
print("Match:", bcrypt.checkpw(password, hash_val))
