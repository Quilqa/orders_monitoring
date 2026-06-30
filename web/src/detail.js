// Лист «Детализация»: таблица снапшота с сортировкой, поиском, фильтрами, пагинацией, CSV.
import { query } from "./db.js";
import { fmtNum, escapeHtml, sqlStr, isNumericCol, exportCSV } from "./util.js";

const PAGE_SIZE = 100;

let columns = [];
let sortCol = null;
let sortDir = "asc";
let search = "";
let page = 0;
let colFilters = {};
let container = null;

export async function initDetail(el) {
  container = el;
  const meta = await query("SELECT * FROM data LIMIT 0");
  columns = meta.columns;
  sortCol = columns.includes("entry_date") ? "entry_date" : columns[0];
  sortDir = columns.includes("entry_date") ? "desc" : "asc";

  container.innerHTML = `
    <div class="panel">
      <div class="table-toolbar">
        <input type="search" id="detail-search" placeholder="Поиск по всем колонкам…" />
        <span class="sql-hint" id="detail-count"></span>
        <button class="btn" id="detail-export" style="margin-left:auto">Экспорт CSV</button>
      </div>
      <div id="detail-table"></div>
      <div class="pager" id="detail-pager"></div>
    </div>`;

  const searchEl = container.querySelector("#detail-search");
  searchEl.addEventListener("input", debounce((e) => { search = e.target.value.trim(); page = 0; render(); }, 250));
  container.querySelector("#detail-export").addEventListener("click", exportAll);
  await render();
}

function buildWhere() {
  const parts = [];
  if (search) {
    const like = sqlStr("%" + search + "%");
    const ors = columns.map((c) => `CAST(${c} AS VARCHAR) ILIKE ${like}`);
    parts.push("(" + ors.join(" OR ") + ")");
  }
  for (const [c, v] of Object.entries(colFilters)) {
    if (v) parts.push(`CAST(${c} AS VARCHAR) ILIKE ${sqlStr("%" + v + "%")}`);
  }
  return parts.length ? "WHERE " + parts.join(" AND ") : "";
}

async function render() {
  const where = buildWhere();
  const { rows: cntRows } = await query(`SELECT count(*) FROM data ${where}`);
  const total = cntRows[0][0];
  const order = sortCol ? `ORDER BY ${sortCol} ${sortDir === "asc" ? "ASC" : "DESC"}` : "";
  const offset = page * PAGE_SIZE;
  const { columns: cols, rows } = await query(
    `SELECT * FROM data ${where} ${order} LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  );

  container.querySelector("#detail-count").textContent = `${fmtNum(total)} строк`;
  container.querySelector("#detail-table").innerHTML = tableHtml(cols, rows);
  container.querySelector("#detail-pager").innerHTML = pagerHtml(total);
  wireHeaders();
  wirePager(total);
}

function tableHtml(cols, rows) {
  const numeric = cols.map((_, i) => isNumericCol(rows, i));
  const head = cols
    .map((c) => {
      const arrow = c === sortCol ? `<span class="arrow">${sortDir === "asc" ? "▲" : "▼"}</span>` : "";
      return `<th data-col="${c}">${escapeHtml(c)}${arrow}</th>`;
    })
    .join("");
  const filterRow = cols
    .map((c) => `<th style="position:sticky"><input data-filter="${c}" value="${escapeHtml(colFilters[c] || "")}" placeholder="фильтр" style="width:100%;font-weight:400;border:1px solid var(--line);border-radius:5px;padding:3px 6px;font-size:12px" /></th>`)
    .join("");
  const body = rows.length
    ? rows
        .map(
          (r) => "<tr>" + r.map((v, i) => `<td class="${numeric[i] ? "num" : ""}">${escapeHtml(numeric[i] ? fmtNum(v) : v)}</td>`).join("") + "</tr>"
        )
        .join("")
    : `<tr><td colspan="${cols.length}" class="empty">Нет данных</td></tr>`;
  return `<div class="table-scroll"><table class="data"><thead><tr>${head}</tr><tr>${filterRow}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function wireHeaders() {
  container.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortCol = col; sortDir = "asc"; }
      page = 0;
      render();
    });
  });
  container.querySelectorAll("input[data-filter]").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("input", debounce((e) => {
      colFilters[inp.dataset.filter] = e.target.value.trim();
      page = 0;
      render();
    }, 300));
  });
}

function pagerHtml(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return `<button id="prev" ${page <= 0 ? "disabled" : ""}>← Назад</button>
    <span>Стр. ${page + 1} из ${pages}</span>
    <button id="next" ${page >= pages - 1 ? "disabled" : ""}>Вперёд →</button>`;
}

function wirePager(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const prev = container.querySelector("#prev");
  const next = container.querySelector("#next");
  if (prev) prev.addEventListener("click", () => { if (page > 0) { page--; render(); } });
  if (next) next.addEventListener("click", () => { if (page < pages - 1) { page++; render(); } });
}

async function exportAll() {
  const where = buildWhere();
  const order = sortCol ? `ORDER BY ${sortCol} ${sortDir === "asc" ? "ASC" : "DESC"}` : "";
  const { columns: cols, rows } = await query(`SELECT * FROM data ${where} ${order}`);
  exportCSV(cols, rows, "detail_export.csv");
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
