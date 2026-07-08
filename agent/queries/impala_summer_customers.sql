-- Impala: клиент из crm2.crm2_crm_customer + признак действующих услуг из
-- drb.drb_aidar_abonent_profile_tm. Pushdown по customer_id драйвера (summer) —
-- не сканируем всех клиентов, только участников акции.
SELECT
    c.customer_id,
    c.name,
    c.identification_number,
    c.mobile_phone,
    c.is_check_mobile_phone,
    c.create_date AS customer_create_date,
    p.has_services
FROM crm2.crm2_crm_customer c
LEFT JOIN (
    SELECT
        customer_id AS cust,
        MAX(CASE WHEN has_shpd + has_ota + has_fms + has_tv + has_lte > 0 THEN 1 ELSE 0 END) AS has_services
    FROM drb.drb_aidar_abonent_profile_tm
    GROUP BY 1
) p ON c.customer_id = p.cust
WHERE c.customer_id IN ({{customer_id__ids}})
