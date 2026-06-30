"""Сериализация снапшота: атомарная запись parquet + meta.json."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd

log = logging.getLogger("agent.snapshot")

# Часовой пояс Алматы (UTC+5) для generated_at.
_TZ = timezone(timedelta(hours=5))


def _atomic_replace(tmp: Path, dst: Path) -> None:
    os.replace(tmp, dst)  # atomic на одной ФС


def write_snapshot(df: pd.DataFrame, data_dir: Path, *,
                   status: str = "ok", error: str | None = None,
                   source_versions: dict | None = None) -> dict:
    """Записать parquet + meta.json атомарно. Возвращает meta-словарь."""
    data_dir.mkdir(parents=True, exist_ok=True)

    parquet_path = data_dir / "snapshot.parquet"
    meta_path = data_dir / "meta.json"

    if status == "ok":
        tmp_parquet = parquet_path.with_suffix(".parquet.tmp")
        df.to_parquet(tmp_parquet, index=False, engine="pyarrow", compression="zstd")
        _atomic_replace(tmp_parquet, parquet_path)

    meta = {
        "generated_at": datetime.now(_TZ).isoformat(),
        "row_count": int(len(df)),
        "columns": [{"name": c, "type": str(df[c].dtype)} for c in df.columns],
        "source_versions": source_versions or {},
        "status": status,
    }
    if error:
        meta["error"] = error

    tmp_meta = meta_path.with_suffix(".json.tmp")
    tmp_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    _atomic_replace(tmp_meta, meta_path)

    log.info("Снапшот записан: %d строк, status=%s", meta["row_count"], status)
    return meta


def mark_stale(data_dir: Path, error: str) -> None:
    """Пометить существующий снапшот как устаревший (новый не публикуется)."""
    meta_path = data_dir / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    else:
        meta = {"row_count": 0, "columns": []}
    meta["status"] = "stale"
    meta["error"] = error
    meta["stale_at"] = datetime.now(_TZ).isoformat()
    tmp = meta_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    _atomic_replace(tmp, meta_path)
    log.warning("Снапшот помечен stale: %s", error)
