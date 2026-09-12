// Общие утилиты: форматирование чисел, экранирование, экспорт CSV, рендер таблиц.

// Целое/десятичное число как строка (DuckDB отдаёт HUGEINT/DECIMAL строкой).
const NUM_RE = /^-?\d+(\.\d+)?$/;

export function asNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && NUM_RE.test(v)) return Number(v);
  return null;
}

export function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "";
  const num = asNumber(n);
  if (num !== null) return num.toLocaleString("ru-RU");
  return String(n);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// SQL-литерал строки (одинарные кавычки экранируются удвоением).
export function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

export function isNumericCol(rows, colIndex) {
  for (const r of rows) {
    const v = r[colIndex];
    if (v !== null && v !== undefined && v !== "") return asNumber(v) !== null;
  }
  return false;
}

export function exportCSV(columns, rows, filename) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map(esc).join(";")];
  for (const r of rows) lines.push(r.map(esc).join(";"));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Рендер HTML-таблицы (без сортировки — для SQL-результата).
export function renderTable(columns, rows) {
  const numeric = columns.map((_, i) => isNumericCol(rows, i));
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        "<tr>" +
        r
          .map((v, i) => `<td class="${numeric[i] ? "num" : ""}">${escapeHtml(numeric[i] ? fmtNum(v) : v)}</td>`)
          .join("") +
        "</tr>"
    )
    .join("");
  return `<div class="table-scroll"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
