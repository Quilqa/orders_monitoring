// Лист «Дашборд»: KPI-карточки + графики Chart.js. Фильтры через DuckDB SQL.
import { query } from "./db.js";
import { fmtNum, sqlStr } from "./util.js";

let charts = [];
let config = null;
let filterState = {};

const PALETTE = ["#2f6df6", "#1f9d55", "#b7791f", "#d64545", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

function aggExpr(agg, field) {
  // Каст к DOUBLE: sum(BIGINT) в DuckDB даёт HUGEINT, который duckdb-wasm
  // возвращает строкой — ломает форматирование чисел и графики.
  if (agg === "sum") return `CAST(sum(${field}) AS DOUBLE)`;
  if (agg === "count_distinct") return `CAST(count(distinct ${field}) AS DOUBLE)`;
  if (agg === "count") return `CAST(count(${field}) AS DOUBLE)`;
  if (agg === "avg") return `CAST(avg(${field}) AS DOUBLE)`;
  return `CAST(sum(${field}) AS DOUBLE)`;
}

function whereClause() {
  const parts = [];
  for (const [field, value] of Object.entries(filterState)) {
    if (value && value !== "__all__") parts.push(`${field} = ${sqlStr(value)}`);
  }
  return parts.length ? "WHERE " + parts.join(" AND ") : "";
}

async function distinctValues(field) {
  const { rows } = await query(`SELECT DISTINCT ${field} FROM data WHERE ${field} IS NOT NULL ORDER BY 1`);
  return rows.map((r) => r[0]);
}

export async function initDashboard(container, dashboardConfig) {
  config = dashboardConfig;
  container.innerHTML = `
    <div class="filters" id="dash-filters"></div>
    <div class="kpis" id="dash-kpis"></div>
    <div class="grid-2" id="dash-widgets"></div>
  `;

  // Фильтры
  const fbox = container.querySelector("#dash-filters");
  for (const f of config.filters || []) {
    const values = await distinctValues(f.field);
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `<label>${f.label}</label>
      <select data-field="${f.field}">
        <option value="__all__">Все</option>
        ${values.map((v) => `<option value="${v}">${v}</option>`).join("")}
      </select>`;
    field.querySelector("select").addEventListener("change", (e) => {
      filterState[f.field] = e.target.value;
      refresh(container);
    });
    fbox.appendChild(field);
    filterState[f.field] = "__all__";
  }

  await refresh(container);
}

async function refresh(container) {
  await renderKPIs(container.querySelector("#dash-kpis"));
  await renderWidgets(container.querySelector("#dash-widgets"));
}

async function renderKPIs(box) {
  const where = whereClause();
  const exprs = (config.kpis || []).map((k, i) => `${aggExpr(k.agg, k.field)} AS k${i}`);
  if (!exprs.length) { box.innerHTML = ""; return; }
  const { rows } = await query(`SELECT ${exprs.join(", ")} FROM data ${where}`);
  const vals = rows[0] || [];
  box.innerHTML = (config.kpis || [])
    .map((k, i) => `<div class="kpi"><div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${fmtNum(vals[i] ?? 0)}</div></div>`)
    .join("");
}

async function renderWidgets(box) {
  charts.forEach((c) => c.destroy());
  charts = [];
  box.innerHTML = "";

  for (const w of config.widgets || []) {
    const panel = document.createElement("div");
    panel.className = "panel" + (w.full ? " full" : "");
    panel.innerHTML = `<h3>${w.title}</h3><div class="chart-wrap"><canvas></canvas></div>`;
    box.appendChild(panel);
    const canvas = panel.querySelector("canvas");
    try {
      if (w.type === "line") await drawLine(canvas, w);
      else await drawBar(canvas, w);
    } catch (e) {
      panel.querySelector(".chart-wrap").innerHTML = `<div class="empty">Ошибка виджета: ${e.message}</div>`;
    }
  }
}

async function drawBar(canvas, w) {
  const where = whereClause();
  const limit = w.limit ? `LIMIT ${w.limit}` : "";
  const { rows } = await query(
    `SELECT ${w.x} AS x, ${aggExpr(w.agg, w.y)} AS y FROM data ${where}
     GROUP BY 1 ORDER BY y DESC ${limit}`
  );
  const labels = rows.map((r) => r[0]);
  const values = rows.map((r) => r[1]);
  charts.push(new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: "#2f6df6", borderRadius: 4 }] },
    options: baseOptions(false),
  }));
}

async function drawLine(canvas, w) {
  const where = whereClause();
  const seriesField = w.series;
  const { rows } = await query(
    `SELECT ${w.x} AS x, ${seriesField ? seriesField : "'all'"} AS s, ${aggExpr(w.agg, w.y)} AS y
     FROM data ${where} GROUP BY 1, 2 ORDER BY 1`
  );
  const labels = [...new Set(rows.map((r) => r[0]))].sort();
  const seriesNames = [...new Set(rows.map((r) => r[1]))];
  const map = {};
  for (const r of rows) map[`${r[1]}|${r[0]}`] = r[2];
  const datasets = seriesNames.map((name, i) => ({
    label: name,
    data: labels.map((x) => map[`${name}|${x}`] ?? 0),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length] + "22",
    tension: 0.25,
    pointRadius: 0,
    borderWidth: 2,
    fill: false,
  }));
  charts.push(new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: baseOptions(seriesNames.length > 1),
  }));
}

function baseOptions(showLegend) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: showLegend, position: "bottom" } },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v) => fmtNum(v) } },
      x: { ticks: { maxRotation: 60, autoSkip: true, maxTicksLimit: 16 } },
    },
  };
}
