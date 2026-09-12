// Загрузка meta.json, индикатор свежести и фоновая автоперезагрузка снапшота.

export async function fetchMeta(metaUrl) {
  const resp = await fetch(metaUrl, { cache: "no-store" });
  if (!resp.ok) throw new Error(`meta.json: ${resp.status}`);
  return resp.json();
}

export function formatGeneratedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

// Периодически опрашивает meta.json; при смене generated_at вызывает onChange(meta).
export function startAutoReload(metaUrl, lastGeneratedAt, onChange, intervalMs = 120000) {
  let current = lastGeneratedAt;
  const timer = setInterval(async () => {
    try {
      const meta = await fetchMeta(metaUrl);
      if (meta.generated_at !== current) {
        current = meta.generated_at;
        onChange(meta);
      }
    } catch (_) {
      /* сеть моргнула — попробуем в следующий раз */
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
