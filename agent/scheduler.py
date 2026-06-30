"""Long-running планировщик на APScheduler: планирует ВСЕ пайплайны
(pipelines/*.yaml) по их собственному расписанию.

Запуск: ``python scheduler.py``. Альтернатива на Windows — отдельные задачи
Task Scheduler, вызывающие ``python collector.py --pipeline <name>``.
"""
from __future__ import annotations

import logging
import sys
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from collector import _setup_logging, run
from config import list_pipelines, load_config

log = logging.getLogger("agent.scheduler")


def _job(pipeline: str) -> None:
    cfg = load_config(pipeline)
    retries = cfg.pipeline.retries
    attempts = int(retries.get("attempts", 3))
    backoff = int(retries.get("backoff_seconds", 30))

    for attempt in range(1, attempts + 1):
        log.info("[%s] запуск сборки (попытка %d/%d)", pipeline, attempt, attempts)
        if run(pipeline=pipeline) == 0:
            return
        if attempt < attempts:
            wait = backoff * attempt
            log.warning("[%s] неуспех, повтор через %d с", pipeline, wait)
            time.sleep(wait)
    log.error("[%s] все попытки исчерпаны — снапшот остаётся stale", pipeline)


def _trigger_for(sched_cfg: dict):
    if sched_cfg.get("mode") == "cron":
        return CronTrigger.from_crontab(sched_cfg.get("cron", "0 5 * * *"),
                                        timezone="Asia/Almaty")
    return IntervalTrigger(minutes=int(sched_cfg.get("interval_minutes", 60)))


def main() -> None:
    _setup_logging()
    pipelines = list_pipelines()
    if not pipelines:
        log.error("Нет пайплайнов в pipelines/*.yaml")
        sys.exit(1)

    scheduler = BackgroundScheduler(timezone="Asia/Almaty")
    for name in pipelines:
        cfg = load_config(name)
        trigger = _trigger_for(cfg.pipeline.schedule)
        scheduler.add_job(_job, trigger, args=[name], id=name,
                          max_instances=1, coalesce=True)
        log.info("Запланирован пайплайн '%s': %s", name, cfg.pipeline.schedule)

    scheduler.start()
    log.info("Планировщик запущен (%d пайплайнов). Первичная сборка — сейчас.", len(pipelines))
    for name in pipelines:   # первый прогон каждого сразу
        _job(name)

    try:
        while True:
            time.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        log.info("Остановка планировщика")
        scheduler.shutdown()
        sys.exit(0)


if __name__ == "__main__":
    main()
