"""Шифрование снапшота (AES-256-GCM).

Формат зашифрованного файла: [12 байт IV][ciphertext+tag].
Тот же формат и параметры читает браузер (web/src/crypto.js).

DEK (data encryption key, 32 байта, base64) берётся из .env (DATA_KEY).
Оборачивание DEK паролями ролей делает setup_encryption.py.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 200_000   # должно совпадать с config.json/iterations и браузером


def encrypt_bytes(plaintext: bytes, dek: bytes) -> bytes:
    """AES-GCM: вернуть IV(12) + ciphertext+tag."""
    iv = os.urandom(12)
    ct = AESGCM(dek).encrypt(iv, plaintext, None)
    return iv + ct


def derive_kek(password: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> bytes:
    """PBKDF2-HMAC-SHA256 -> 32-байтный ключ (как в браузере)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(password.encode("utf-8"))


def wrap_dek(dek: bytes, password: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> str:
    """Зашифровать DEK ключом из пароля. Вернуть base64(IV+ct)."""
    kek = derive_kek(password, salt, iterations)
    iv = os.urandom(12)
    ct = AESGCM(kek).encrypt(iv, dek, None)
    return base64.b64encode(iv + ct).decode("ascii")


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def from_b64(s: str) -> bytes:
    return base64.b64decode(s)
