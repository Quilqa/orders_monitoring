// Парольный вход с расшифровкой снапшота (envelope encryption) + сессия на 12ч.
// Пароль -> PBKDF2 -> KEK -> разворачивает DEK. Успешный разворот = верный пароль.
// Сессия: DEK (сырой) + роль + срок хранятся в localStorage, чтобы не вводить пароль
// после каждой перезагрузки. «Выйти» стирает сессию сразу.
//
// Компромисс: пока сессия жива, ключ расшифровки лежит в localStorage браузера —
// доступен тому, у кого доступ к этому профилю. Для рабочей машины приемлемо.

import { unwrapDEK, importDEK, bytesToB64, b64ToBytes } from "./crypto.js";

const SESSION_KEY = "metrics_session";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

// Возвращает { role, dek } или null. При успехе сохраняет сессию на 12ч.
export async function login(password, auth) {
  const res = await unwrapDEK(password, auth);
  if (!res) return null;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      role: res.role,
      dek: bytesToB64(res.dekRaw),
      exp: Date.now() + TTL_MS,
    }));
  } catch (_) { /* приватный режим и т.п. — работаем без сохранения */ }
  return { role: res.role, dek: await importDEK(res.dekRaw) };
}

// Восстановить сессию, если она есть и не истекла. Иначе null.
export async function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.exp || Date.now() > s.exp) { localStorage.removeItem(SESSION_KEY); return null; }
    return { role: s.role, dek: await importDEK(b64ToBytes(s.dek)) };
  } catch (_) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}
