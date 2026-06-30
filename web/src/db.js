// DuckDB-WASM: загрузка снапшота Parquet и выполнение SQL прямо в браузере.
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

let _db = null;
let _conn = null;

export async function initDuckDB() {
  if (_conn) return _conn;
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  _db = new duckdb.AsyncDuckDB(logger, worker);
  await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  _conn = await _db.connect();
  return _conn;
}

let _files = new Set(); // зарегистрированные виртуальные файлы
let _views = new Set(); // созданные представления

async function registerParquet(conn, url, vname, table) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Не удалось загрузить ${url}: ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  await _db.registerFileBuffer(vname, buf);
  _files.add(vname);
  await conn.query(`CREATE OR REPLACE VIEW "${table}" AS SELECT * FROM parquet_scan('${vname}')`);
  _views.add(table);
}

// Загрузить снапшот (таблица `data`) + исходные таблицы из meta.source_tables.
// baseDir — каталог датасета (напр. ../data/today). Безопасно при смене датасета.
export async function loadSnapshot(baseDir, meta) {
  const conn = await initDuckDB();
  // очистить регистрацию предыдущего датасета
  for (const v of _views) { try { await conn.query(`DROP VIEW IF EXISTS "${v}"`); } catch (_) {} }
  for (const f of _files) { try { await _db.dropFile(f); } catch (_) {} }
  _views.clear();
  _files.clear();

  await registerParquet(conn, `${baseDir}/snapshot.parquet`, "snapshot.parquet", "data");
  for (const name of (meta && meta.source_tables) || []) {
    try {
      await registerParquet(conn, `${baseDir}/sources/${name}.parquet`, `src_${name}.parquet`, name);
    } catch (e) {
      console.warn("Источник не загружен:", name, e.message);
    }
  }
  return conn;
}

// Список доступных таблиц (для подсказки в SQL).
export async function listTables() {
  const conn = await initDuckDB();
  const r = await conn.query(
    `SELECT table_name FROM information_schema.tables ORDER BY table_name`
  );
  return r.toArray().map((row) => row.table_name);
}

// Выполнить SQL, вернуть { columns: string[], rows: any[][] }.
export async function query(sql) {
  const conn = await initDuckDB();
  const result = await conn.query(sql);
  const columns = result.schema.fields.map((f) => f.name);
  const rows = result.toArray().map((r) => columns.map((c) => normalize(r[c])));
  return { columns, rows };
}

function normalize(v) {
  if (typeof v === "bigint") return Number(v);
  return v;
}
