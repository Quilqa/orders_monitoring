// Лист «Детализация»: таблица снапшота с сортировкой, поиском, Excel-фильтрами, пагинацией, CSV.
import { query } from "./db.js";
import { fmtNum, escapeHtml, sqlStr, isNumericCol, exportCSV } from "./util.js";

const PAGE_SIZE = 100;
const DISTINCT_LIMIT = 2000;

let columns = [];
let sortCol = null;
let sortDir = "asc";
let search = "";
let page = 0;
let colFilters = {}; // { col: { vals: string[], nul: bool } }
let container = null;
let pop = null; // открытая выпадашка фильтра

export async function initDetail(el) {
  container = el;
  const meta = await query("SELECT * FROM data LIMIT 0");
  columns = meta.columns;
  sortCol = ["created_at", "entry_date"].find((c) => columns.includes(c)) || columns[0];
  sortDir = "desc";
  colFilters = {};

  container.innerHTML = `
    <div class="panel">
      <div class="table-toolbar">
        <input type="search" id="detail-search" placeholder="Поиск по всем колонкам…" />
        <span class="sql-hint" id="detail-count"></span>
        <button class="btn" id="detail-reset">Сбросить фильтры</button>
        <button class="btn" id="detail-export">Экспорт CSV</button>
      </div>
      <div id="detail-table"></div>
      <div class="pager" id="detail-pager"></div>
    </div>`;

  container.querySelector("#detail-search")
    .addEventListener("input", debounce((e) => { search = e.target.value.trim(); page = 0; render(); }, 250));
  container.querySelector("#detail-export").addEventListener("click", exportAll);
  container.querySelector("#detail-reset").addEventListener("click", () => {
    colFilters = {}; search = ""; page = 0;
    container.querySelector("#detail-search").value = "";
    render();
  });
  await render();
}

function filterCond(col, f) {
  const conds = [];
  if (f.vals && f.vals.length) conds.push(`CAST(${col} AS VARCHAR) IN (${f.vals.map(sqlStr).join(",")})`);
  if (f.nul) conds.push(`${col} IS NULL`);
  return conds.length ? "(" + conds.join(" OR ") + ")" : null;
}

function buildWhere() {
  const parts = [];
  if (search) {
    const like = sqlStr("%" + search + "%");
    parts.push("(" + columns.map((c) => `CAST(${c} AS VARCHAR) ILIKE ${like}`).join(" OR ") + ")");
  }
  for (const [c, f] of Object.entries(colFilters)) {
    const cond = filterCond(c, f);
    if (cond) parts.push(cond);
  }
  return parts.length ? "WHERE " + parts.join(" AND ") : "";
}

async function render() {
  const where = buildWhere();
  const { rows: cntRows } = await query(`SELECT count(*) FROM data ${where}`);
  const total = cntRows[0][0];
  const order = sortCol ? `ORDER BY ${sortCol} ${sortDir === "asc" ? "ASC" : "DESC"}` : "";
  const { columns: cols, rows } = await query(
    `SELECT * FROM data ${where} ${order} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`
  );

  container.querySelector("#detail-count").textContent = `${fmtNum(total)} строк`;
  container.querySelector("#detail-table").innerHTML = tableHtml(cols, rows);
  container.querySelector("#detail-pager").innerHTML = pagerHtml(total);
  wireHeaders();
  wirePager(total);
}

function tableHtml(cols, rows) {
  const numeric = cols.map((_, i) => isNumericCol(rows, i));
  const statusIdx = cols.indexOf("status");
  const head = cols.map((c) => {
    const arrow = c === sortCol ? `<span class="arrow">${sortDir === "asc" ? "▲" : "▼"}</span>` : "";
    const active = colFilters[c] ? " active" : "";
    return `<th data-col="${escapeHtml(c)}">
      <span class="th-label">${escapeHtml(c)}${arrow}</span>
      <button class="th-filter${active}" data-fcol="${escapeHtml(c)}" title="Фильтр">▾</button></th>`;
  }).join("");

  const body = rows.length
    ? rows.map((r) => {
        const isError = statusIdx >= 0 && String(r[statusIdx]).toLowerCase() === "error";
        const cells = r.map((v, i) => {
          if (i === statusIdx && isError)
            return `<td class="cell-error">⚠ ${escapeHtml(v)}</td>`;
          return `<td class="${numeric[i] ? "num" : ""}">${escapeHtml(numeric[i] ? fmtNum(v) : v)}</td>`;
        }).join("");
        return `<tr class="${isError ? "row-error" : ""}">${cells}</tr>`;
      }).join("")
    : `<tr><td colspan="${cols.length}" class="empty">Нет данных</td></tr>`;

  return `<div class="table-scroll"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function wireHeaders() {
  container.querySelectorAll(".th-label").forEach((lbl) => {
    lbl.addEventListener("click", () => {
      const col = lbl.closest("th").dataset.col;
      if (sortCol === col) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortCol = col; sortDir = "asc"; }
      page = 0;
      render();
    });
  });
  container.querySelectorAll(".th-filter").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openFilter(btn.dataset.fcol, btn); });
  });
}

// ---------- Excel-подобная выпадашка фильтра ----------
async function openFilter(col, anchor) {
  closePop();
  const cur = colFilters[col] || null;

  // distinct значения (+ признак наличия NULL)
  const [{ rows: vrows }, { rows: nrows }] = await Promise.all([
    query(`SELECT DISTINCT CAST(${col} AS VARCHAR) v FROM data WHERE ${col} IS NOT NULL ORDER BY 1 LIMIT ${DISTINCT_LIMIT + 1}`),
    query(`SELECT count(*) FROM data WHERE ${col} IS NULL`),
  ]);
  const truncated = vrows.length > DISTINCT_LIMIT;
  const values = vrows.slice(0, DISTINCT_LIMIT).map((r) => String(r[0]));
  const hasNull = nrows[0][0] > 0;

  // множество выбранных: из активного фильтра либо всё (по умолчанию всё выбрано)
  const sel = new Set(cur ? cur.vals : values);
  let selNull = cur ? !!cur.nul : hasNull;

  pop = document.createElement("div");
  pop.className = "col-filter-pop";
  pop.innerHTML = `
    <input type="search" class="cf-search" placeholder="Поиск значения…" />
    <label class="cf-all"><input type="checkbox" class="cf-allbox" checked /> (Выделить все)</label>
    <div class="cf-list"></div>
    ${truncated ? `<div class="cf-hint">Показаны первые ${DISTINCT_LIMIT}. Уточните поиск.</div>` : ""}
    <div class="cf-actions">
      <button class="btn primary cf-apply">Применить</button>
      <button class="btn cf-reset">Сбросить</button>
    </div>`;
  document.body.appendChild(pop);
  positionPop(anchor);

  const listEl = pop.querySelector(".cf-list");
  const searchEl = pop.querySelector(".cf-search");
  const allBox = pop.querySelector(".cf-allbox");

  function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const shown = values.filter((v) => !q || v.toLowerCase().includes(q));
    const rowsHtml = [];
    if (hasNull && (!q || "(пусто)".includes(q)))
      rowsHtml.push(`<label class="cf-item"><input type="checkbox" data-null="1" ${selNull ? "checked" : ""}/> <em>(пусто)</em></label>`);
    for (const v of shown)
      rowsHtml.push(`<label class="cf-item"><input type="checkbox" data-v="${escapeHtml(v)}" ${sel.has(v) ? "checked" : ""}/> ${escapeHtml(v)}</label>`);
    listEl.innerHTML = rowsHtml.join("") || `<div class="cf-hint">Ничего не найдено</div>`;
    listEl.querySelectorAll("input[data-v]").forEach((c) =>
      c.addEventListener("change", () => { c.checked ? sel.add(c.dataset.v) : sel.delete(c.dataset.v); }));
    const nb = listEl.querySelector("input[data-null]");
    if (nb) nb.addEventListener("change", () => { selNull = nb.checked; });
  }
  renderList();

  searchEl.addEventListener("input", debounce(renderList, 150));
  allBox.addEventListener("change", () => {
    const q = searchEl.value.trim().toLowerCase();
    const shown = values.filter((v) => !q || v.toLowerCase().includes(q));
    if (allBox.checked) shown.forEach((v) => sel.add(v)); else shown.forEach((v) => sel.delete(v));
    if (hasNull && (!q || "(пусто)".includes(q))) selNull = allBox.checked;
    renderList();
  });

  pop.querySelector(".cf-apply").addEventListener("click", () => {
    const allSelected = sel.size >= values.length && (!hasNull || selNull) && !truncated;
    if ((sel.size === 0 && !selNull) || allSelected) delete colFilters[col];
    else colFilters[col] = { vals: [...sel], nul: selNull };
    closePop();
    page = 0;
    render();
  });
  pop.querySelector(".cf-reset").addEventListener("click", () => {
    delete colFilters[col];
    closePop();
    page = 0;
    render();
  });

  setTimeout(() => document.addEventListener("mousedown", outsideClose), 0);
}

function positionPop(anchor) {
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 340)}px`;
  pop.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
}

function outsideClose(e) {
  if (pop && !pop.contains(e.target)) closePop();
}
function closePop() {
  document.removeEventListener("mousedown", outsideClose);
  if (pop) { pop.remove(); pop = null; }
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
  const order = sortCol ? `ORDER BY ${sortCol} ${sortDir === "asc" ? "ASC" : "DESC"}` : "";
  const { columns: cols, rows } = await query(`SELECT * FROM data ${buildWhere()} ${order}`);
  exportCSV(cols, rows, "detail_export.csv");
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
