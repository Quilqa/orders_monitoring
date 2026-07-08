-- Postgre (promotions_prod, env_prefix SUMMER_PG): состояния клиентов летней
-- промоакции + участия. Драйвер пайплайна summer — из него pushdown customer_id.
SELECT
    to_char(p.created_at, 'YYYYMM')::int AS report_period_id,
    p.created_at::date AS entry_date,
    cs.id,
    cs.customer_id,
    cs.eligibility_status,
    cs.is_employee,
    to_char(cs.checked_at, 'YYYY-MM-DD HH24:MI:SS') AS checked_at,
    to_char(cs.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
    p.participation_number,
    p.promo_code,
    to_char(p.created_at, 'YYYY-MM-DD HH24:MI:SS') AS participation_date
FROM summer_promo_client_state cs
LEFT JOIN summer_promo_participants p ON cs.customer_id = p.customer_id
