-- Базовый агрегирующий запрос проекта (Impala).
-- Результат: platform, metrics, entry_date, cnt
--
-- ВНИМАНИЕ: колонка `metrics` в исходной таблице содержит ПЛАТФОРМУ
-- (TelecomKz / Aitu), а название метрики — в `event_type`.
-- Поэтому в SELECT они переименованы местами.
--
-- Admin: дополни whitelist Aitu (event_type IN (...)) актуальным списком.

-- TelecomKz (все метрики) + Aitu (только whitelist)
SELECT metrics      AS platform,
       event_type   AS metrics,
       entry_date,
       count(*)     AS cnt
FROM drb.drb_iliyas_amplitude_metrics_full
WHERE event_type IS NOT NULL AND event_type != ''
  AND (
        metrics = 'TelecomKz'
        OR (metrics = 'Aitu' AND event_type IN (
              'miniapp_opened',
              'main_tab_selected'
              -- TODO(admin): добавить остальные события whitelist Aitu
        ))
      )
GROUP BY 1, 2, 3

UNION ALL

-- Loyalty (без временных акционных метрик)
SELECT 'Loyalty'              AS platform,
       event_type             AS metrics,
       left(event_time, 10)   AS entry_date,
       count(*)               AS cnt
FROM external_sources.amplitude_loyalty_program_logs
WHERE event_type IS NOT NULL AND event_type != ''
  AND event_type NOT LIKE 'detail_promo_%'
  AND event_type NOT LIKE 'company_promo_%'
GROUP BY 1, 2, 3
