"""Подключение к Impala через impyla с failover на резервный хост."""
from __future__ import annotations

import logging

import pandas as pd

from config import ImpalaConfig
from ssl_patch import patch_thrift_ssl

log = logging.getLogger("agent.impala")


def _connect(cfg: ImpalaConfig, host: str):
    from impala.dbapi import connect

    return connect(
        host=host,
        port=cfg.port,
        database=cfg.database,
        user=cfg.user,
        password=cfg.password,
        use_ssl=cfg.use_ssl,
        auth_mechanism=cfg.auth_mechanism,
        timeout=cfg.timeout,
    )


def connect_with_failover(cfg: ImpalaConfig):
    """Подключиться к основному хосту, при ошибке — к резервному."""
    patch_thrift_ssl()
    try:
        log.info("Impala: подключение к основному хосту %s", cfg.primary_host)
        return _connect(cfg, cfg.primary_host)
    except Exception as e:  # noqa: BLE001
        log.warning("Impala: основной хост недоступен (%s), пробую резервный %s",
                    e, cfg.backup_host)
        return _connect(cfg, cfg.backup_host)


def run_query(cfg: ImpalaConfig, sql: str) -> pd.DataFrame:
    conn = connect_with_failover(cfg)
    try:
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall()
        columns = [desc[0] for desc in cur.description]
        df = pd.DataFrame(rows, columns=columns)
        log.info("Impala: запрос вернул %d строк", len(df))
        return df
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
