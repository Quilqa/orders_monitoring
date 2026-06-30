-- Impala: клиент из crm2.crm2_crm_customer (имя/ИИН/телефон).
-- Pushdown по customer_id драйвера.
SELECT
    customer_id,
    name,
    identification_number,
    mobile_phone
FROM crm2.crm2_crm_customer
WHERE customer_id IN ({{customer_id__ids}})
