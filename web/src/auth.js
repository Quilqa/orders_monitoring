// Парольный вход с расшифровкой снапшота (envelope encryption).
// Пароль -> PBKDF2 -> KEK -> разворачивает DEK (из config.json auth.roles[].wrap).
// Успешное разворачивание = верный пароль И ключ для расшифровки parquet.
// Без пароля публичные файлы зашифрованы и бесполезны (см. crypto.js / agent).

import { unwrapDEK } from "./crypto.js";

const SESSION_KEY = "metrics_role";

// Возвращает { role, dek } или null.
export async function login(password, auth) {
  return unwrapDEK(password, auth);
}

export function saveRole(role) {
  sessionStorage.setItem(SESSION_KEY, role);
}

export function currentRole() {
  return sessionStorage.getItem(SESSION_KEY);
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
