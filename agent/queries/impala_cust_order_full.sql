-- Impala: обогащение из drb.drb_iliyas_cust_order_full.
-- Pushdown по customer_id из драйвера (плейсхолдер {{customer_id__ids}}),
-- чтобы не сканировать таблицу целиком. Таймстемпы приводятся к TIMESTAMP.
SELECT
    customer_id,
    cast(order_date_create AS timestamp) AS order_date_create,
    cast(order_close_date  AS timestamp) AS order_close_date,
    type_name,
    status_name,
    sales_channel_name,
    username_created_order,
    reject_reason_name,
    new_product_offer_id,
    new_product_offer_name,
    cust_order_id,
    customer_account_id,
    comments,
    comment_on_close
FROM drb.drb_iliyas_cust_order_full
WHERE customer_id IN ({{customer_id__ids}})
