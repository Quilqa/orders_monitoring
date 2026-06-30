-- Сборка TODAY (DuckDB). Таблицы: customer_orders (Postgre),
-- cust_order_day_detail, crm_customer (Impala).
-- Прямое соединение по id заказа: customer_orders.crm_order_id = day.id
-- (в отличие от historical, где соединяли по customer_id + окно дат).
-- recreated_order здесь не вычисляется (нет дублирующего cust_order_id) -> 0.

SELECT
    CAST(replace(strftime(t.created_at, '%Y-%m'), '-', '') AS INTEGER) AS report_period_id,
    strftime(t.created_at, '%Y-%m-%d')                                  AS entry_date,
    t.id,
    t.customer_id,
    t.crm_order_id,
    t.status,
    strftime(t.created_at, '%Y-%m-%d %H:%M:%S')                         AS created_at,
    c.name,
    c.identification_number,
    c.mobile_phone,
    co.type_name,
    co.status_name,
    co.sales_channel_name,
    strftime(co.order_date_create, '%Y-%m-%d %H:%M:%S')                 AS order_date_create,
    strftime(co.order_close_date,  '%Y-%m-%d %H:%M:%S')                 AS order_close_date,
    co.username_created_order,
    co.reject_reason_name,
    TRY_CAST(co.new_product_offer_id AS BIGINT)                         AS new_product_offer_id,
    co.new_product_offer_name,
    TRY_CAST(co.id AS BIGINT)                                           AS cust_order_id,
    TRY_CAST(co.customer_account_id AS BIGINT)                          AS customer_account_id,
    co.comments,
    co.comment_on_close,
    0                                                                   AS recreated_order
FROM customer_orders t
LEFT JOIN cust_order_day_detail co
    ON CAST(t.crm_order_id AS BIGINT) = CAST(co.id AS BIGINT)
LEFT JOIN crm_customer c
    ON CAST(t.customer_id AS BIGINT) = CAST(c.customer_id AS BIGINT)
ORDER BY t.created_at DESC
