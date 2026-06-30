"""Главный сборщик: выполняет запросы источников, объединяет, валидирует,
пишет снапшот. Запуск: ``python collector.py [--sample] [--publish]``.
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

from config import Config, DATA_DIR, LOG_DIR, load_config
from snapshot import mark_stale, write_snapshot

log = logging.getLogger("agent.collector")


class ValidationError(Exception):
    pass


def _setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(LOG_DIR / "agent.log", encoding="utf-8"),
        ],
    )


def _read_query(cfg: Config, query_file: str) -> str:
    return (cfg.queries_dir / query_file).read_text(encoding="utf-8")


def collect(cfg: Config) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
    """Выполнить источники и объединить. Возвращает (итоговый df, {имя_источника: df})."""
    combine = cfg.pipeline.combine
    if combine == "union_all":
        return _collect_union(cfg)
    if combine == "duckdb_join":
        return _collect_duckdb_join(cfg)
    raise ValidationError(f"Неподдерживаемый combine: {combine}")


def _run_source(cfg: Config, src, sql: str) -> pd.DataFrame:
    if src.type == "impala":
        if not cfg.impala.configured:
            raise ValidationError("Impala не сконфигурирован (нет IMPALA_USER/PASSWORD в .env)")
        import db_impala
        return db_impala.run_query(cfg.impala, sql)
    if src.type == "postgres":
        if not cfg.postgres.configured:
            raise ValidationError("Postgre не сконфигурирован (нет PG_* в .env)")
        import db_postgres
        return db_postgres.run_query(cfg.postgres, sql)
    raise ValidationError(f"Неизвестный тип источника: {src.type}")


def _collect_union(cfg: Config) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
    frames = []
    tables = {}
    for src in cfg.pipeline.sources:
        sql = _read_query(cfg, src.query_file)
        log.info("Источник '%s' (%s): выполняю %s", src.name, src.type, src.query_file)
        df = _run_source(cfg, src, sql)
        frames.append(df)
        tables[src.name] = df
    if not frames:
        raise ValidationError("Нет источников в pipeline.yaml")
    return pd.concat(frames, ignore_index=True), tables


# --- combine: duckdb_join (межбазовая сборка) ---

def _sql_literal_list(series: pd.Series) -> str:
    """distinct не-NULL значения серии как SQL-список для IN (...)."""
    vals = series.dropna().unique()
    if len(vals) == 0:
        return "NULL"
    if pd.api.types.is_numeric_dtype(series):
        return ", ".join(str(int(v)) if float(v).is_integer() else repr(float(v)) for v in vals)
    return ", ".join("'" + str(v).replace("'", "''") + "'" for v in vals)


def _sql_literal(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _substitute(sql: str, driver_df: pd.DataFrame) -> str:
    """Подставить плейсхолдеры из драйвера:
    {{col__ids}} -> distinct значения col как список; {{col__min}}/{{col__max}}.
    """
    import re

    def repl(m):
        col, kind = m.group(1), m.group(2)
        if col not in driver_df.columns:
            raise ValidationError(f"Плейсхолдер {{{{{col}__{kind}}}}}: нет колонки '{col}' в драйвере")
        if kind == "ids":
            return _sql_literal_list(driver_df[col])
        if kind == "min":
            return _sql_literal(driver_df[col].min())
        if kind == "max":
            return _sql_literal(driver_df[col].max())
        raise ValidationError(f"Неизвестный вид плейсхолдера: {kind}")

    return re.sub(r"\{\{(\w+)__(ids|min|max)\}\}", repl, sql)


def _collect_duckdb_join(cfg: Config) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
    import duckdb

    if not cfg.pipeline.driver or not cfg.pipeline.assemble_file:
        raise ValidationError("combine: duckdb_join требует 'driver' и 'assemble_file' в pipeline.yaml")

    by_name = {s.name: s for s in cfg.pipeline.sources}
    driver_name = cfg.pipeline.driver
    if driver_name not in by_name:
        raise ValidationError(f"driver '{driver_name}' не найден среди sources")

    # 1) Драйвер — первым (из него считаются плейсхолдеры для pushdown).
    drv = by_name[driver_name]
    log.info("Драйвер '%s' (%s): выполняю %s", drv.name, drv.type, drv.query_file)
    driver_df = _run_source(cfg, drv, _read_query(cfg, drv.query_file))
    log.info("Драйвер '%s': %d строк", drv.name, len(driver_df))

    tables = {driver_name: driver_df}

    # 2) Остальные источники — с подстановкой плейсхолдеров.
    for src in cfg.pipeline.sources:
        if src.name == driver_name:
            continue
        sql = _substitute(_read_query(cfg, src.query_file), driver_df)
        log.info("Источник '%s' (%s): выполняю %s", src.name, src.type, src.query_file)
        tables[src.name] = _run_source(cfg, src, sql)
        log.info("Источник '%s': %d строк", src.name, len(tables[src.name]))

    # 3) Финальная сборка join в DuckDB.
    assemble_sql = (cfg.queries_dir / cfg.pipeline.assemble_file).read_text(encoding="utf-8")
    con = duckdb.connect()
    try:
        for name, df in tables.items():
            con.register(name, df)
        log.info("DuckDB: выполняю сборку %s", cfg.pipeline.assemble_file)
        result = con.execute(assemble_sql).df()
    finally:
        con.close()
    log.info("Сборка: %d строк, %d колонок", len(result), result.shape[1])
    return result, tables


def validate(cfg: Config, df: pd.DataFrame) -> None:
    expected = cfg.pipeline.expected_columns
    missing = [c for c in expected if c not in df.columns]
    if missing:
        raise ValidationError(f"Отсутствуют ожидаемые колонки: {missing}")
    n = len(df)
    if n < cfg.pipeline.min_rows:
        raise ValidationError(f"Слишком мало строк: {n} < {cfg.pipeline.min_rows}")
    if n > cfg.pipeline.max_rows:
        raise ValidationError(f"Слишком много строк: {n} > {cfg.pipeline.max_rows}")


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Привести типы к компактным/предсказуемым для parquet и браузера."""
    out = df.copy()
    for col in ("platform", "metrics", "entry_date"):
        if col in out.columns:
            out[col] = out[col].astype("string")
    if "cnt" in out.columns:
        out["cnt"] = pd.to_numeric(out["cnt"], errors="coerce").fillna(0).astype("int64")
    return out


def make_sample(n_days: int = 60) -> pd.DataFrame:
    """Синтетический датасет той же схемы — чтобы поднять веб без доступа к БД."""
    import random
    from datetime import date, timedelta

    platforms = {
        "TelecomKz": ["app_open", "login", "payment_success", "search", "main_tab_selected"],
        "Aitu": ["miniapp_opened", "main_tab_selected"],
        "Loyalty": ["card_view", "points_earned", "points_spent", "offer_click"],
    }
    rng = random.Random(42)
    today = date.today()
    rows = []
    for d in range(n_days):
        day = (today - timedelta(days=d)).isoformat()
        for platform, metrics in platforms.items():
            for m in metrics:
                base = rng.randint(50, 5000)
                trend = int(base * (1 + (n_days - d) / n_days * 0.5))
                rows.append({"platform": platform, "metrics": m,
                             "entry_date": day, "cnt": trend + rng.randint(-base // 5, base // 5)})
    return pd.DataFrame(rows)


def run(pipeline: str = "historical", sample: bool = False, publish: bool = False) -> int:
    cfg = load_config(pipeline)
    data_dir = cfg.data_dir
    log.info("Пайплайн '%s' -> %s", pipeline, data_dir)
    try:
        if sample:
            df, sources = make_sample(), {}
        else:
            df, sources = collect(cfg)
        df = normalize(df)
        validate(cfg, df)
        dek = None
        if cfg.pipeline.encrypt:
            if not cfg.data_key_b64:
                raise ValidationError("encrypt: true, но DATA_KEY не задан в .env "
                                      "(сгенерируй: python setup_encryption.py)")
            import base64
            dek = base64.b64decode(cfg.data_key_b64)
        meta = write_snapshot(
            df, data_dir,
            source_versions={"pipeline": pipeline, "impala": cfg.impala.database,
                             "mode": "sample" if sample else "live"},
            source_tables=(sources if cfg.pipeline.export_sources else None),
            dek=dek,
        )
        log.info("Готово ['%s']: %d строк -> %s", pipeline, meta["row_count"], data_dir)
        if publish or cfg.pipeline.publish.get("mode", "none") != "none":
            _publish(cfg)
        return 0
    except Exception as e:  # noqa: BLE001
        log.exception("Сборка не удалась ['%s']", pipeline)
        mark_stale(data_dir, str(e))
        return 1


def _git(args: list[str], env: dict | None = None) -> tuple[int, str]:
    import subprocess
    from config import REPO_DIR
    p = subprocess.run(["git", "-C", str(REPO_DIR)] + args,
                       capture_output=True, text=True, env=env)
    return p.returncode, p.stdout.strip()


def _push_url(cfg: Config, remote: str) -> str:
    """URL пуша с токеном из .env (если задан). В .git/config не сохраняется."""
    _, url = _git(["remote", "get-url", remote])
    url = url.strip()
    if cfg.github_token and url.startswith("https://"):
        return url.replace("https://", f"https://{cfg.github_token}@", 1)
    return url


def _publish(cfg: Config) -> None:
    mode = cfg.pipeline.publish.get("mode", "none")
    if mode == "git":
        _publish_branch(cfg)                 # снапшот коммитится в main (растит историю)
    elif mode == "git_orphan_pages":
        _publish_orphan_pages(cfg)           # site -> ветка gh-pages одним orphan-коммитом
    else:
        log.info("Публикация ['%s']: mode=%s — пропуск", cfg.pipeline.name, mode)


def _publish_orphan_pages(cfg: Config) -> None:
    """Публикация САЙТА (web/ + data/) в ветку одним orphan-коммитом + force-push.

    История ветки не растёт (всегда ровно один коммит). Не трогает рабочее дерево
    main: используется отдельный временный индекс через git-плумбинг.
    Pages должен раздаваться из этой ветки (см. README).
    """
    import os
    from config import REPO_DIR

    publish = cfg.pipeline.publish
    branch = publish.get("git_branch", "gh-pages")
    remote = publish.get("git_remote", "origin")

    index_file = str(REPO_DIR / ".git" / f"index.pages.{cfg.pipeline.name}")
    env = dict(os.environ, GIT_INDEX_FILE=index_file)
    try:
        _git(["read-tree", "--empty"], env=env)
        # -f: data/ исключён из основного .gitignore, но в site он нужен
        _git(["add", "-f", "--", "web", "data"], env=env)  # сайт = только web/ и data/
        code, tree = _git(["write-tree"], env=env)
        if code != 0 or not tree:
            log.error("Публикация ['%s']: write-tree не удался", cfg.pipeline.name)
            return
        msg = f"site: автообновление ({cfg.pipeline.name})"
        code, commit = _git(["commit-tree", tree, "-m", msg], env=env)  # без -p => orphan
        if code != 0 or not commit:
            log.error("Публикация ['%s']: commit-tree не удался", cfg.pipeline.name)
            return
        _git(["update-ref", f"refs/heads/{branch}", commit])
    finally:
        try:
            os.remove(index_file)
        except OSError:
            pass

    code, _ = _git(["push", "--force", _push_url(cfg, remote), f"{branch}:{branch}"])
    if code == 0:
        log.info("Публикация ['%s']: сайт -> %s/%s (1 orphan-коммит, force) — Pages обновится",
                 cfg.pipeline.name, remote, branch)
    else:
        log.error("Публикация ['%s']: push в %s не удался (код %d)", cfg.pipeline.name, branch, code)


def _publish_branch(cfg: Config) -> None:
    """Старый режим: коммит data/<subdir> в обычную ветку (растит историю)."""
    publish = cfg.pipeline.publish
    branch = publish.get("git_branch", "main")
    remote = publish.get("git_remote", "origin")

    _git(["add", f"data/{cfg.pipeline.output_subdir}"])
    if _git(["diff", "--cached", "--quiet"])[0] == 0:
        log.info("Публикация ['%s']: снапшот не изменился — пуш не нужен", cfg.pipeline.name)
        return
    code, _ = _git(["commit", "-m", f"data[{cfg.pipeline.output_subdir}]: автообновление снапшота"])
    if code != 0:
        log.error("Публикация: commit не удался")
        return
    code, _ = _git(["push", _push_url(cfg, remote), f"HEAD:{branch}"])
    if code != 0:
        _git(["pull", "--rebase", "--autostash", remote, branch])
        code, _ = _git(["push", _push_url(cfg, remote), f"HEAD:{branch}"])
    log.info("Публикация ['%s']: %s в %s/%s", cfg.pipeline.name,
             "ok" if code == 0 else "ОШИБКА", remote, branch)


def main() -> None:
    _setup_logging()
    p = argparse.ArgumentParser(description="Сборщик снапшота")
    p.add_argument("--pipeline", default="historical",
                   help="имя пайплайна (файл pipelines/<name>.yaml). По умолчанию: historical")
    p.add_argument("--sample", action="store_true",
                   help="сгенерировать синтетический снапшот без доступа к БД")
    p.add_argument("--publish", action="store_true", help="опубликовать снапшот после сборки")
    args = p.parse_args()
    sys.exit(run(pipeline=args.pipeline, sample=args.sample, publish=args.publish))


if __name__ == "__main__":
    main()
