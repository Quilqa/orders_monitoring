-- Impala: из crm2.crm2_crm_cust_order нужны только id, существующие среди
-- crm_order_id драйвера (для фильтра "заказ ещё не заведён в CRM").
-- Pushdown по {{crm_order_id__ids}} — вместо выгрузки всей таблицы.
SELECT DISTINCT id
FROM crm2.crm2_crm_cust_order
WHERE id IN ({{crm_order_id__ids}})
