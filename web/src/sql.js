// Лист «SQL»: ad-hoc запросы по снапшоту (DuckDB-WASM). Таблица доступна как `data`.
import { query } from "./db.js";
import { renderTable, exportCSV, isNumericCol, asNumber } from "./util.js";

const DEFAULT_SQL = "SELECT platform, sum(cnt) AS events\nFROM data\nGROUP BY 1\nORDER BY events DESC";

let lastResult = null;
let chart = null;

export function initSql(el) {
  el.innerHTML = `
    <div class="panel">
      <h3>SQL по снапшоту — таблица доступна как <code>data</code></h3>
      <textarea class="sql-editor" id="sql-input" spellcheck="false">${DEFAULT_SQL}</textarea>
      <div class="sql-bar">
        <button class="btn primary" id="sql-run">▶ Выполнить (Ctrl+Enter)</button>
        <button class="btn" id="sql-chart" disabled>📊 Быстрый график</button>
        <button class="btn" id="sql-csv" disabled>Экспорт CSV</button>
        <span class="sql-hint">Только SELECT. Данные локальны в браузере.</span>
      </div>
      <div id="sql-output"></div>
    </div>`;

  const input = el.querySelector("#sql-input");
  el.querySelector("#sql-run").addEventListener("click", () => run(el));
  el.querySelector("#sql-chart").addEventListener("click", () => quickChart(el));
  el.querySelector("#sql-csv").addEventListener("click", () => {
    if (lastResult) exportCSV(lastResult.columns, lastResult.rows, "sql_result.csv");
  });
  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(el); }
  });
}

async function run(el) {
  const sql = el.querySelector("#sql-input").value.trim().replace(/;+\s*$/, "");
  const out = el.querySelector("#sql-output");
  if (!sql) return;
  if (!/^\s*(select|with|pragma|describe|show)\b/i.test(sql)) {
    out.innerHTML = `<div class="sql-error">Разрешены только запросы на чтение (SELECT / WITH / DESCRIBE / SHOW).</div>`;
    toggle(el, false);
    return;
  }
  out.innerHTML = `<div class="empty">Выполняется…</div>`;
  try {
    const result = await query(sql);
    lastResult = result;
    if (!result.rows.length) {
      out.innerHTML = `<div class="empty">Запрос вернул 0 строк</div>`;
      toggle(el, false);
      return;
    }
    out.innerHTML = `<div class="sql-hint" style="margin-bottom:8px">${result.rows.length} строк</div>` +
      renderTable(result.columns, result.rows) +
      `<div class="chart-wrap" id="sql-chart-wrap" style="margin-top:16px;display:none"><canvas id="sql-canvas"></canvas></div>`;
    toggle(el, true);
  } catch (e) {
    out.innerHTML = `<div class="sql-error">${e.message}</div>`;
    toggle(el, false);
  }
}

function toggle(el, on) {
  el.querySelector("#sql-chart").disabled = !on;
  el.querySelector("#sql-csv").disabled = !on;
}

// Быстрый график: 1-я колонка — подписи, первая числовая — значения.
function quickChart(el) {
  if (!lastResult) return;
  const { columns, rows } = lastResult;
  const valIdx = columns.findIndex((_, i) => i > 0 && isNumericCol(rows, i));
  if (valIdx < 0) return;
  const wrap = el.querySelector("#sql-chart-wrap");
  wrap.style.display = "block";
  if (chart) chart.destroy();
  chart = new Chart(el.querySelector("#sql-canvas"), {
    type: "bar",
    data: {
      labels: rows.map((r) => r[0]),
      datasets: [{ label: columns[valIdx], data: rows.map((r) => asNumber(r[valIdx])), backgroundColor: "#2f6df6", borderRadius: 4 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}
