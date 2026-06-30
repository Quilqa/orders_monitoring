// Точка входа: вход по паролю → выбор датасета → загрузка снапшота → вкладки.
import { loadSnapshot } from "./db.js";
import { checkPassword, saveRole, currentRole, logout } from "./auth.js";
import { fetchMeta, formatGeneratedAt, startAutoReload } from "./meta.js";
import { initDashboard } from "./dashboard.js";
import { initDetail } from "./detail.js";
import { initSql } from "./sql.js";

let CONFIG = null;
let META = null;
let dashboardConfig = null;
let currentDatasetId = null;
let stopReload = null;
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
    const role = await checkPassword(pw, CONFIG.auth);
    if (!role) { errEl.hidden = false; return; }
    saveRole(role);
    await enterApp(role);
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
    if (META.status === "ok" || META.status === "stale") {
      await loadSnapshot(dataUrl("snapshot.parquet"));
    }
    if (!dashboardConfig) {
      dashboardConfig = await (await fetch("dashboard.json", { cache: "no-store" })).json();
    }
  } catch (e) {
    hideBoot();
    document.getElementById("content").innerHTML =
      `<div class="panel"><div class="empty">Не удалось загрузить данные: ${e.message}<br/><br/>
       Проверьте, что снапшот собран и файлы доступны в <code>${currentDir()}</code>.</div></div>`;
    return;
  }

  inited.dashboard = inited.detail = inited.sql = false;
  renderFreshness();
  await showView(activeView());
  hideBoot();

  stopReload = startAutoReload(dataUrl("meta.json"), META.generated_at, async (meta) => {
    META = meta;
    await loadSnapshot(dataUrl("snapshot.parquet"));
    inited.dashboard = inited.detail = inited.sql = false;
    renderFreshness();
    await showView(activeView());
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

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      await showView(tab.dataset.view);
    });
  });
}

async function showView(view) {
  for (const v of ["dashboard", "detail", "sql"]) {
    document.getElementById(`view-${v}`).hidden = v !== view;
  }
  const el = document.getElementById(`view-${view}`);
  if (inited[view]) return;
  if (view === "dashboard") await initDashboard(el, dashboardConfig);
  else if (view === "detail") await initDetail(el);
  else if (view === "sql") initSql(el);
  inited[view] = true;
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
  const role = currentRole();
  if (role) await enterApp(role);
  else showLogin();
})();
