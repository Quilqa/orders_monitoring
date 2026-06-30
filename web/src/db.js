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

// Зарегистрировать snapshot.parquet и создать представление `data`.
export async function loadSnapshot(url) {
  const conn = await initDuckDB();
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Не удалось загрузить снапшот: ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  await _db.registerFileBuffer("snapshot.parquet", buf);
  await conn.query(`CREATE OR REPLACE VIEW data AS SELECT * FROM parquet_scan('snapshot.parquet')`);
  return conn;
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
