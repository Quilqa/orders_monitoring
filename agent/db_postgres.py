"""Подключение к Postgre через psycopg3 (опциональный источник)."""
from __future__ import annotations

import logging

import pandas as pd

from config import PostgresConfig

log = logging.getLogger("agent.postgres")


def run_query(cfg: PostgresConfig, sql: str) -> pd.DataFrame:
    import psycopg

    conninfo = (
        f"host={cfg.host} port={cfg.port} dbname={cfg.dbname} "
        f"user={cfg.user} password={cfg.password} sslmode={cfg.sslmode}"
    )
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]
    df = pd.DataFrame(rows, columns=columns)
    log.info("Postgre: запрос вернул %d строк", len(df))
    return df
