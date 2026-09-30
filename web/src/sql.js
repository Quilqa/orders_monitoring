// Лист «SQL»: ad-hoc запросы по снапшоту (DuckDB-WASM). Итог доступен как `data`,
// плюс исходные таблицы Impala/Postgre (из data/<пайплайн>/sources/).
// Слева — браузер схемы (все таблицы и колонки). Запрос можно сохранить
// как кастомную детализацию (отдельный лист).
import { query, getSchema } from "./db.js";
import { renderTable, exportCSV, escapeHtml, isNumericCol, asNumber } from "./util.js";
import { addCustomView } from "./custom.js";

const DEFAULT_SQL = "SELECT status, count(*) AS orders\nFROM data\nGROUP BY 1\nORDER BY orders DESC";

let lastResult = null;
let chart = null;

export function initSql(el, presetSql) {
  el.innerHTML = `
    <div class="sql-layout">
      <aside class="sql-schema panel">
        <h3>Таблицы</h3>
        <div id="sql-schema-list"><div class="empty">Загрузка схемы…</div></div>
      </aside>
      <div class="sql-main panel">
        <h3>SQL по снапшоту — итог доступен как <code>data</code></h3>
        <textarea class="sql-editor" id="sql-input" spellcheck="false">${escapeHtml(presetSql || DEFAULT_SQL)}</textarea>
        <div class="sql-bar">
          <button class="btn primary" id="sql-run">▶ Выполнить (Ctrl+Enter)</button>
          <button class="btn" id="sql-chart" disabled>📊 Быстрый график</button>
          <button class="btn" id="sql-csv" disabled>Экспорт CSV</button>
          <button class="btn" id="sql-save">💾 Сохранить как детализацию</button>
          <span class="sql-hint">Только SELECT. Данные локальны в браузере.</span>
        </div>
        <div id="sql-output"></div>
      </div>
    </div>`;

  const input = el.querySelector("#sql-input");
  el.querySelector("#sql-run").addEventListener("click", () => run(el));
  el.querySelector("#sql-chart").addEventListener("click", () => quickChart(el));
  el.querySelector("#sql-csv").addEventListener("click", () => {
    if (lastResult) exportCSV(lastResult.columns, lastResult.rows, "sql_result.csv");
  });
  el.querySelector("#sql-save").addEventListener("click", () => saveAsDetail(el));
  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(el); }
  });
  buildSchema(el);
}

async function buildSchema(el) {
  const box = el.querySelector("#sql-schema-list");
  try {
    const schema = await getSchema();
    const names = Object.keys(schema);
    if (!names.length) { box.innerHTML = `<div class="empty">Нет таблиц</div>`; return; }
    box.innerHTML = names.map((t) => `
      <div class="schema-table">
        <div class="schema-th" data-table="${escapeHtml(t)}">
          <span class="schema-caret">▸</span>
          <span class="schema-name">${escapeHtml(t)}</span>
          <span class="schema-cnt">${schema[t].length}</span>
        </div>
        <ul class="schema-cols" hidden>
          ${schema[t].map((c) => `<li data-col="${escapeHtml(c.name)}"><span>${escapeHtml(c.name)}</span><em>${escapeHtml(c.type)}</em></li>`).join("")}
        </ul>
      </div>`).join("");

    box.querySelectorAll(".schema-th").forEach((th) => {
      th.addEventListener("click", (e) => {
        const block = th.parentElement;
        const ul = block.querySelector(".schema-cols");
        // клик по имени таблицы (двойной/с Shift) — вставить SELECT; одиночный — раскрыть
        if (e.shiftKey) { fillSelect(el, th.dataset.table); return; }
        ul.hidden = !ul.hidden;
        th.querySelector(".schema-caret").textContent = ul.hidden ? "▸" : "▾";
      });
      th.querySelector(".schema-name").addEventListener("dblclick", (e) => {
        e.stopPropagation();
        fillSelect(el, th.dataset.table);
      });
    });
    box.querySelectorAll(".schema-cols li").forEach((li) => {
      li.addEventListener("click", () => insertAtCursor(el, li.dataset.col));
    });
  } catch (e) {
    box.innerHTML = `<div class="sql-error">${escapeHtml(e.message)}</div>`;
  }
}

function fillSelect(el, table) {
  const input = el.querySelector("#sql-input");
  input.value = `SELECT *\nFROM "${table}"\nLIMIT 100`;
  input.focus();
  run(el);
}

function insertAtCursor(el, text) {
  const input = el.querySelector("#sql-input");
  const s = input.selectionStart ?? input.value.length;
  const e = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, s) + text + input.value.slice(e);
  input.focus();
  input.selectionStart = input.selectionEnd = s + text.length;
}

function saveAsDetail(el) {
  const sql = el.querySelector("#sql-input").value.trim().replace(/;+\s*$/, "");
  if (!sql) return;
  if (!/^\s*(select|with)\b/i.test(sql)) {
    alert("Сохранять можно только SELECT / WITH запросы.");
    return;
  }
  const name = prompt("Название детализации:", "Моя детализация");
  if (!name || !name.trim()) return;
  const view = addCustomView(name, sql);
  document.dispatchEvent(new CustomEvent("opencustomview", { detail: view.id }));
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
