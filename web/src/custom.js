// Кастомные детализации: сохранённые SQL-запросы, отображаемые как отдельные
// листы с сортировкой/поиском/пагинацией/CSV. Хранятся в localStorage браузера.
import { query } from "./db.js";
import { fmtNum, escapeHtml, isNumericCol, exportCSV, asNumber } from "./util.js";

const LS_KEY = "custom_views";
const PAGE_SIZE = 100;

// ---------- Хранилище ----------
export function getCustomViews() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function save(views) {
  localStorage.setItem(LS_KEY, JSON.stringify(views));
  document.dispatchEvent(new Event("customviewschanged"));
}

export function addCustomView(name, sql) {
  const views = getCustomViews();
  const view = { id: "cv_" + Date.now().toString(36), name: name.trim(), sql: sql.trim() };
  views.push(view);
  save(views);
  return view;
}

export function deleteCustomView(id) {
  save(getCustomViews().filter((v) => v.id !== id));
}

export function getCustomView(id) {
  return getCustomViews().find((v) => v.id === id);
}

// ---------- Рендер листа ----------
export async function renderCustomView(el, view) {
  el.innerHTML = `
    <div class="panel">
      <div class="cv-head">
        <div>
          <h3 style="margin:0">${escapeHtml(view.name)}</h3>
          <code class="cv-sql">${escapeHtml(view.sql)}</code>
        </div>
        <div class="cv-actions">
          <button class="btn" id="cv-edit">✎ Открыть в SQL</button>
          <button class="btn" id="cv-delete">🗑 Удалить</button>
        </div>
      </div>
      <div id="cv-body"><div class="empty">Выполняется…</div></div>
    </div>`;

  el.querySelector("#cv-delete").addEventListener("click", () => {
    if (confirm(`Удалить детализацию «${view.name}»?`)) deleteCustomView(view.id);
  });
  el.querySelector("#cv-edit").addEventListener("click", () => {
    // открыть SQL-вкладку с этим запросом для правки
    document.dispatchEvent(new CustomEvent("editcustomsql", { detail: view }));
  });

  const body = el.querySelector("#cv-body");
  try {
    const { columns, rows } = await query(view.sql);
    if (!rows.length) {
      body.innerHTML = `<div class="empty">Запрос вернул 0 строк</div>`;
      return;
    }
    interactiveTable(body, columns, rows, `${view.name}.csv`);
  } catch (e) {
    body.innerHTML = `<div class="sql-error">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Интерактивная таблица (клиентская: сортировка/поиск/пагинация/CSV) ----------
export function interactiveTable(container, columns, rows, filename) {
  const numeric = columns.map((_, i) => isNumericCol(rows, i));
  let sortCol = null, sortDir = "asc", search = "", page = 0;

  container.innerHTML = `
    <div class="table-toolbar">
      <input type="search" class="it-search" placeholder="Поиск по всем колонкам…" />
      <span class="sql-hint it-count"></span>
      <button class="btn it-csv" style="margin-left:auto">Экспорт CSV</button>
    </div>
    <div class="it-table"></div>
    <div class="pager it-pager"></div>`;

  const searchEl = container.querySelector(".it-search");
  const tableEl = container.querySelector(".it-table");
  const pagerEl = container.querySelector(".it-pager");
  const countEl = container.querySelector(".it-count");

  function filtered() {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) => row.some((v) => String(v ?? "").toLowerCase().includes(q)));
    }
    if (sortCol !== null) {
      const num = numeric[sortCol];
      r = [...r].sort((a, b) => {
        let x = a[sortCol], y = b[sortCol];
        if (num) { x = asNumber(x) ?? -Infinity; y = asNumber(y) ?? -Infinity; }
        else { x = String(x ?? ""); y = String(y ?? ""); }
        return (x < y ? -1 : x > y ? 1 : 0) * (sortDir === "asc" ? 1 : -1);
      });
    }
    return r;
  }

  function render() {
    const r = filtered();
    const pages = Math.max(1, Math.ceil(r.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
    const slice = r.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    countEl.textContent = `${fmtNum(r.length)} строк`;

    const head = columns.map((c, i) => {
      const arrow = i === sortCol ? `<span class="arrow">${sortDir === "asc" ? "▲" : "▼"}</span>` : "";
      return `<th data-i="${i}">${escapeHtml(c)}${arrow}</th>`;
    }).join("");
    const body = slice.map((row) =>
      "<tr>" + row.map((v, i) =>
        `<td class="${numeric[i] ? "num" : ""}">${escapeHtml(numeric[i] ? fmtNum(v) : v)}</td>`
      ).join("") + "</tr>"
    ).join("");
    tableEl.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

    tableEl.querySelectorAll("th[data-i]").forEach((th) => {
      th.addEventListener("click", () => {
        const i = +th.dataset.i;
        if (sortCol === i) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortCol = i; sortDir = "asc"; }
        render();
      });
    });

    pagerEl.innerHTML = `<button class="it-prev" ${page <= 0 ? "disabled" : ""}>← Назад</button>
      <span>Стр. ${page + 1} из ${pages}</span>
      <button class="it-next" ${page >= pages - 1 ? "disabled" : ""}>Вперёд →</button>`;
    pagerEl.querySelector(".it-prev").addEventListener("click", () => { if (page > 0) { page--; render(); } });
    pagerEl.querySelector(".it-next").addEventListener("click", () => { if (page < pages - 1) { page++; render(); } });
  }

  let t;
  searchEl.addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { search = e.target.value.trim(); page = 0; render(); }, 200);
  });
  container.querySelector(".it-csv").addEventListener("click", () => exportCSV(columns, filtered(), filename));

  render();
}
