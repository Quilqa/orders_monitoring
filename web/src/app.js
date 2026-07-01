// Точка входа: вход по паролю → выбор датасета → загрузка снапшота → вкладки.
import { loadSnapshot, setDecryptionKey } from "./db.js";
import { login, restoreSession, logout } from "./auth.js";
import { fetchMeta, formatGeneratedAt, startAutoReload } from "./meta.js";
import { initDashboard } from "./dashboard.js";
import { initDetail } from "./detail.js";
import { initSql } from "./sql.js";
import { getCustomViews, getCustomView, deleteCustomView, renderCustomView } from "./custom.js";
import { escapeHtml } from "./util.js";

let CONFIG = null;
let META = null;
let dashboardConfig = null;
let currentDatasetId = null;
let stopReload = null;
let currentDEK = null; // ключ расшифровки, полученный при входе
let activeCustomId = null; // id открытого кастомного листа
let sqlPreset = null; // запрос для правки, передаётся в SQL-вкладку
const inited = { dashboard: false, detail: false, sql: false };

async function loadConfig() {
  const resp = await fetch("config.json", { cache: "no-store" });
  return resp.json();
}

// ---------- Датасеты ----------
function datasetList() {
  if (CONFIG.datasets && CONFIG.datasets.length) return CONFIG.datasets;
  return [{ id: "default", label: "Данные", dir: CONFIG.dataBase || "../data" }];
}
function currentDir() {
  const list = datasetList();
  return (list.find((d) => d.id === currentDatasetId) || list[0]).dir;
}
function dataUrl(name) {
  return `${currentDir()}/${name}`;
}

// ---------- Вход ----------
function showLogin() {
  document.getElementById("login").hidden = false;
  document.getElementById("app").hidden = true;
}

async function setupLogin() {
  const form = document.getElementById("login-form");
  const errEl = document.getElementById("login-error");
  document.getElementById("login-title").textContent = CONFIG.title || "Дашборд";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const pw = document.getElementById("login-password").value;
    const res = await login(pw, CONFIG.auth);
    if (!res) { errEl.hidden = false; return; }
    currentDEK = res.dek;
    await enterApp(res.role);
  });
}

// ---------- Приложение ----------
async function enterApp(role) {
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("app-title").textContent = CONFIG.title || "Дашборд";
  const badge = document.getElementById("role-badge");
  badge.textContent = role;
  badge.style.background = role === "admin" ? "#e8f0fe" : "#eef2f6";

  setupTabs();
  setupLogout();
  setupDatasetSelect();
  setupCustomEvents();
  renderCustomTabs();

  const list = datasetList();
  currentDatasetId =
    CONFIG.defaultDataset && list.some((d) => d.id === CONFIG.defaultDataset)
      ? CONFIG.defaultDataset
      : list[0].id;
  document.getElementById("dataset-select").value = currentDatasetId;

  await loadDataset();
}

// Загрузка/перезагрузка текущего датасета (вызывается при входе и при смене датасета).
async function loadDataset() {
  if (stopReload) { stopReload(); stopReload = null; }
  showBoot("Загрузка снапшота…");
  try {
    META = await fetchMeta(dataUrl("meta.json"));
    setDecryptionKey(META.encrypted ? currentDEK : null);
    if (META.status === "ok" || META.status === "stale") {
      await loadSnapshot(currentDir(), META);
    }
    if (!dashboardConfig) {
      dashboardConfig = await (await fetch("dashboard.json", { cache: "no-store" })).json();
    }
  } catch (e) {
    hideBoot();
    // Возможно устарел ключ (сменили пароль/ключ) — предложим войти заново.
    const decryptErr = e && (e.name === "OperationError" || /decrypt|operation/i.test(e.message || ""));
    document.getElementById("content").innerHTML =
      `<div class="panel"><div class="empty">Не удалось загрузить данные: ${e.message}<br/><br/>
       ${decryptErr ? "Возможно, изменился ключ шифрования — " : "Проверьте, что снапшот собран и доступен. "}
       <button class="btn" id="relogin">Войти заново</button></div></div>`;
    document.getElementById("relogin")?.addEventListener("click", () => { logout(); location.reload(); });
    return;
  }

  inited.dashboard = inited.detail = inited.sql = false;
  renderFreshness();
  await showView(activeView(), activeCustomId);
  hideBoot();

  stopReload = startAutoReload(dataUrl("meta.json"), META.generated_at, async (meta) => {
    META = meta;
    await loadSnapshot(currentDir(), meta);
    inited.dashboard = inited.detail = inited.sql = false;
    renderFreshness();
    await showView(activeView(), activeCustomId);
  });
}

function activeView() {
  return document.querySelector(".tab.active")?.dataset.view || "dashboard";
}

function renderFreshness() {
  const el = document.getElementById("freshness");
  el.textContent = `Данные обновлены: ${formatGeneratedAt(META.generated_at)}`;
  const banner = document.getElementById("stale-banner");
  if (META.status === "stale") {
    el.classList.add("stale");
    banner.hidden = false;
    banner.textContent = `⚠ Данные устарели: последняя сборка не удалась${META.error ? " — " + META.error : ""}. Показан предыдущий снапшот.`;
  } else {
    el.classList.remove("stale");
    banner.hidden = true;
  }
}

function setupDatasetSelect() {
  const sel = document.getElementById("dataset-select");
  const list = datasetList();
  sel.innerHTML = list.map((d) => `<option value="${d.id}">${d.label}</option>`).join("");
  sel.hidden = list.length < 2;
  sel.addEventListener("change", async () => {
    currentDatasetId = sel.value;
    await loadDataset();
  });
}

// Делегированный клик по навигации (включая динамические кастомные вкладки).
function setupTabs() {
  document.querySelector(".tabs").addEventListener("click", async (e) => {
    const close = e.target.closest(".tab-close");
    if (close) {
      e.stopPropagation();
      deleteCustomView(close.dataset.id);
      return;
    }
    const tab = e.target.closest(".tab");
    if (!tab) return;
    await activateTab(tab.dataset.view, tab.dataset.id || null);
  });
}

async function activateTab(view, customId) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  const sel = customId
    ? document.querySelector(`.tab[data-id="${customId}"]`)
    : document.querySelector(`.tab[data-view="${view}"]:not([data-id])`);
  if (sel) sel.classList.add("active");
  activeCustomId = view === "custom" ? customId : null;
  await showView(view, customId);
}

// Динамические вкладки кастомных детализаций — после статических.
function renderCustomTabs() {
  const nav = document.querySelector(".tabs");
  nav.querySelectorAll(".tab[data-view='custom']").forEach((t) => t.remove());
  for (const v of getCustomViews()) {
    const b = document.createElement("button");
    b.className = "tab tab-custom";
    b.dataset.view = "custom";
    b.dataset.id = v.id;
    b.innerHTML = `<span>${escapeHtml(v.name)}</span><span class="tab-close" data-id="${v.id}" title="Удалить">×</span>`;
    nav.appendChild(b);
  }
}

async function showView(view, customId) {
  for (const v of ["dashboard", "detail", "sql", "custom"]) {
    document.getElementById(`view-${v}`).hidden = v !== view;
  }
  const el = document.getElementById(`view-${view}`);
  if (view === "custom") {
    const v = getCustomView(customId);
    el.innerHTML = "";
    if (v) await renderCustomView(el, v);
    return;
  }
  if (inited[view]) return;
  if (view === "dashboard") await initDashboard(el, dashboardConfig);
  else if (view === "detail") await initDetail(el);
  else if (view === "sql") { initSql(el, sqlPreset); sqlPreset = null; }
  inited[view] = true;
}

// События от SQL-вкладки и кастомных листов.
function setupCustomEvents() {
  document.addEventListener("customviewschanged", () => {
    renderCustomTabs();
    // если открытый кастомный лист удалён — вернуться на SQL
    if (activeCustomId && !getCustomView(activeCustomId)) activateTab("sql");
  });
  document.addEventListener("opencustomview", (e) => {
    renderCustomTabs();
    activateTab("custom", e.detail);
  });
  document.addEventListener("editcustomsql", (e) => {
    sqlPreset = e.detail.sql;
    inited.sql = false; // переинициализировать SQL с этим запросом
    activateTab("sql");
  });
}

function setupLogout() {
  document.getElementById("logout").addEventListener("click", () => {
    logout();
    location.reload();
  });
}

function showBoot(msg) {
  const o = document.getElementById("boot-overlay");
  document.getElementById("boot-msg").textContent = msg;
  o.hidden = false;
}
function hideBoot() { document.getElementById("boot-overlay").hidden = true; }

// ---------- Старт ----------
(async function main() {
  CONFIG = await loadConfig();
  await setupLogin();
  // Восстановить сессию (12ч), если есть — иначе просим пароль.
  const restored = await restoreSession();
  if (restored) { currentDEK = restored.dek; await enterApp(restored.role); }
  else showLogin();
})();
