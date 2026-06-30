// Простой парольный вход. Роль определяется тем, какой пароль совпал.
// ВНИМАНИЕ (раздел 8 PRD): это защищает только UI. На публичном хостинге
// сам snapshot.parquet доступен по прямому URL. Для реальной защиты данных —
// Cloudflare Access / шифрование снапшота / приватный хостинг.

const SESSION_KEY = "metrics_role";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPassword(password, auth) {
  const hash = await sha256(password);
  if (hash === auth.adminHash) return "admin";
  if (hash === auth.viewerHash) return "viewer";
  return null;
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
