// Дешифрование снапшота (AES-256-GCM) в браузере. Совместимо с agent/crypto_util.py.
// Формат файла/обёртки: [12 байт IV][ciphertext+tag].

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// PBKDF2-HMAC-SHA256(пароль, salt, iters) -> AES-GCM ключ (KEK) для разворачивания DEK.
async function deriveKEK(password, salt, iterations) {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

// Развернуть DEK паролем. Возвращает { role, dekRaw: Uint8Array } или null.
export async function unwrapDEK(password, auth) {
  const salt = b64ToBytes(auth.salt);
  const iterations = auth.iterations;
  const kek = await deriveKEK(password, salt, iterations);
  for (const { role, wrap } of auth.roles) {
    try {
      const w = b64ToBytes(wrap);
      const dekRaw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: w.slice(0, 12) }, kek, w.slice(12)
      );
      return { role, dekRaw: new Uint8Array(dekRaw) };
    } catch (_) {
      // этот wrap не для введённого пароля — пробуем следующий
    }
  }
  return null;
}

// Импортировать сырой DEK (Uint8Array) в CryptoKey для расшифровки.
export async function importDEK(dekRaw) {
  return crypto.subtle.importKey("raw", dekRaw, "AES-GCM", false, ["decrypt"]);
}

// Расшифровать содержимое parquet-файла (Uint8Array IV+ct) ключом DEK.
export async function decryptBytes(dek, bytes) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) }, dek, bytes.slice(12)
  );
  return new Uint8Array(pt);
}
