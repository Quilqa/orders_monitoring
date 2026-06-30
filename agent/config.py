"""Загрузка конфигурации агента.

Секреты (логины/пароли/хосты) — из ``.env`` (НЕ коммитится).
Несекретный конфиг (состав запросов, объединение, расписание, валидация) —
из ``pipeline.yaml``.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv не установлен — читаем только реальное окружение
    def load_dotenv(*a, **kw):
        return False

AGENT_DIR = Path(__file__).resolve().parent
REPO_DIR = AGENT_DIR.parent
DATA_DIR = REPO_DIR / "data"
LOG_DIR = AGENT_DIR / "logs"
PIPELINES_DIR = AGENT_DIR / "pipelines"


@dataclass
class ImpalaConfig:
    primary_host: str
    backup_host: str
    port: int
    database: str
    user: str
    password: str
    use_ssl: bool = True
    auth_mechanism: str = "PLAIN"
    timeout: int = 60

    @property
    def configured(self) -> bool:
        return bool(self.user and self.password)


@dataclass
class PostgresConfig:
    host: str
    port: int
    dbname: str
    user: str
    password: str
    sslmode: str = "prefer"

    @property
    def configured(self) -> bool:
        return bool(self.host and self.dbname and self.user)


@dataclass
class Source:
    name: str
    type: str           # "impala" | "postgres"
    query_file: str


@dataclass
class Pipeline:
    name: str
    output_subdir: str                 # data/<output_subdir>/snapshot.parquet
    output_dataset: str
    combine: str                       # "union_all" | "duckdb_join"
    sources: list[Source]
    expected_columns: list[str]
    min_rows: int
    max_rows: int
    schedule: dict
    retries: dict
    driver: str | None = None        # имя источника-драйвера для combine: duckdb_join
    assemble_file: str | None = None  # DuckDB-SQL сборки для combine: duckdb_join
    publish: dict = field(default_factory=dict)  # {mode: none|git, git_branch, git_remote}
    export_sources: bool = False     # сохранять исходные таблицы в data/<subdir>/sources/
    encrypt: bool = False            # шифровать parquet (AES-GCM ключом DATA_KEY из .env)


@dataclass
class Config:
    impala: ImpalaConfig
    postgres: PostgresConfig
    pipeline: Pipeline
    github_token: str = ""           # для публикации (git push); из .env, не коммитится
    data_key_b64: str = ""           # base64 DEK для шифрования снапшота; из .env
    queries_dir: Path = field(default=AGENT_DIR / "queries")

    @property
    def data_dir(self) -> Path:
        return DATA_DIR / self.pipeline.output_subdir


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def list_pipelines() -> list[str]:
    """Имена всех пайплайнов (файлы pipelines/*.yaml)."""
    if not PIPELINES_DIR.exists():
        return []
    return sorted(p.stem for p in PIPELINES_DIR.glob("*.yaml"))


def load_config(pipeline: str = "historical") -> Config:
    load_dotenv(AGENT_DIR / ".env")

    impala = ImpalaConfig(
        primary_host=_env("IMPALA_PRIMARY_HOST", "bdas-worker-08.bdpak.telecom.kz"),
        backup_host=_env("IMPALA_BACKUP_HOST", "bdas-utility-01.bdpak.telecom.kz"),
        port=int(_env("IMPALA_PORT", "21050")),
        database=_env("IMPALA_DATABASE", "drb"),
        user=_env("IMPALA_USER"),
        password=_env("IMPALA_PASSWORD"),
        use_ssl=_env("IMPALA_USE_SSL", "true").lower() == "true",
        auth_mechanism=_env("IMPALA_AUTH_MECHANISM", "PLAIN"),
        timeout=int(_env("IMPALA_TIMEOUT", "60")),
    )

    postgres = PostgresConfig(
        host=_env("PG_HOST"),
        port=int(_env("PG_PORT", "5432")),
        dbname=_env("PG_DBNAME"),
        user=_env("PG_USER"),
        password=_env("PG_PASSWORD"),
        sslmode=_env("PG_SSLMODE", "prefer"),
    )

    pipeline_path = PIPELINES_DIR / f"{pipeline}.yaml"
    if not pipeline_path.exists():
        raise FileNotFoundError(f"Нет пайплайна '{pipeline}': {pipeline_path}")
    with open(pipeline_path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    sources = [
        Source(name=s["name"], type=s["type"], query_file=s["query_file"])
        for s in raw["sources"]
    ]

    pipeline_obj = Pipeline(
        name=pipeline,
        output_subdir=raw.get("output_subdir", pipeline),
        output_dataset=raw.get("output_dataset", "snapshot"),
        combine=raw.get("combine", "union_all"),
        sources=sources,
        expected_columns=raw["validation"]["expected_columns"],
        min_rows=raw["validation"].get("min_rows", 1),
        max_rows=raw["validation"].get("max_rows", 200000),
        schedule=raw.get("schedule", {}),
        retries=raw.get("retries", {"attempts": 3, "backoff_seconds": 30}),
        driver=raw.get("driver"),
        assemble_file=raw.get("assemble_file"),
        publish=raw.get("publish", {}),
        export_sources=raw.get("export_sources", False),
        encrypt=raw.get("encrypt", False),
    )

    return Config(impala=impala, postgres=postgres, pipeline=pipeline_obj,
                  github_token=_env("GITHUB_TOKEN"), data_key_b64=_env("DATA_KEY"))
