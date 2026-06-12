"""Symmetric encryption for sensitive fields (UP Banking tokens, etc.)

Uses Fernet (AES-128-CBC + HMAC-SHA256) with a key derived from SECRET_KEY.
Safe to store ciphertext in the database — decryption requires SECRET_KEY.
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet

from .config import get_settings


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    secret = get_settings().secret_key.encode()
    # Derive a 32-byte key from SECRET_KEY using SHA-256, then base64url-encode it
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()


def is_encrypted(value: str) -> bool:
    """Detect already-encrypted values so we can migrate plaintext tokens."""
    try:
        _fernet().decrypt(value.encode())
        return True
    except Exception:
        return False
