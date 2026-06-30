"""Генерация ключа шифрования (DEK) и паролей доступа.

Создаёт:
  - DATA_KEY в agent/.env (base64 DEK, секрет, не коммитится),
  - блок auth в web/config.json: salt, iterations и «обёрнутый» DEK для каждой роли
    (admin/viewer). Браузер из введённого пароля выводит ключ, разворачивает DEK
    и расшифровывает parquet.

Запуск:
  python setup_encryption.py --admin-pass ADMIN --viewer-pass VIEWER
По умолчанию пароли admin123 / viewer123 (как сейчас).

ВАЖНО: повторный запуск генерирует НОВЫЙ DEK — после него нужно пересобрать
снапшоты (collector.py), иначе старые зашифрованы прежним ключом.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import AGENT_DIR, REPO_DIR
from crypto_util import PBKDF2_ITERATIONS, b64, wrap_dek

WEB_CONFIG = REPO_DIR / "web" / "config.json"
ENV_FILE = AGENT_DIR / ".env"


def _set_env_var(path: Path, key: str, value: str) -> None:
    lines = []
    found = False
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    p = argparse.ArgumentParser(description="Генерация DEK и паролей доступа (шифрование снапшота)")
    p.add_argument("--admin-pass", default="admin123")
    p.add_argument("--viewer-pass", default="viewer123")
    args = p.parse_args()

    dek = AESGCM.generate_key(bit_length=256)        # 32 байта
    salt = secrets.token_bytes(16)

    roles = [
        {"role": "admin", "wrap": wrap_dek(dek, args.admin_pass, salt)},
        {"role": "viewer", "wrap": wrap_dek(dek, args.viewer_pass, salt)},
    ]
    auth = {
        "_comment": "Envelope encryption: пароль -> PBKDF2 -> KEK -> разворачивает DEK (wrap) "
                    "-> расшифровка parquet. salt публичен; файлы бесполезны без пароля.",
        "scheme": "aesgcm-pbkdf2",
        "salt": b64(salt),
        "iterations": PBKDF2_ITERATIONS,
        "roles": roles,
    }

    cfg = json.loads(WEB_CONFIG.read_text(encoding="utf-8")) if WEB_CONFIG.exists() else {}
    cfg["auth"] = auth
    WEB_CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    _set_env_var(ENV_FILE, "DATA_KEY", base64.b64encode(dek).decode("ascii"))

    print("OK:")
    print(f"  DATA_KEY  -> {ENV_FILE} (секрет, не коммитится)")
    print(f"  auth      -> {WEB_CONFIG}")
    print(f"  пароли    -> admin: {args.admin_pass} | viewer: {args.viewer_pass}")
    print("Теперь пересобери снапшоты: python collector.py --pipeline today (и historical).")


if __name__ == "__main__":
    main()
