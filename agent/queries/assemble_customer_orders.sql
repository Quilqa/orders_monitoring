-- Финальная сборка (DuckDB) межбазового JOIN.
-- Зарегистрированные таблицы = имена источников из pipeline.yaml:
--   customer_orders (Postgre), cust_order_full, crm_cust_order_ids, crm_customer (Impala).
-- customer_id в Impala — double, в Postgre — integer: ключи приводим к BIGINT.

WITH t AS (
    -- заказы, ещё не заведённые в CRM
    SELECT *
    FROM customer_orders
    WHERE CAST(crm_order_id AS BIGINT) NOT IN (
        SELECT CAST(id AS BIGINT) FROM crm_cust_order_ids WHERE id IS NOT NULL
    )
),
co_ranked AS (
    SELECT
        co.*,
        ROW_NUMBER() OVER (
            PARTITION BY CAST(co.customer_id AS BIGINT)
            ORDER BY co.order_date_create DESC
        ) AS rn
    FROM cust_order_full co
    WHERE EXISTS (
        SELECT 1 FROM t t2
        WHERE CAST(t2.customer_id AS BIGINT) = CAST(co.customer_id AS BIGINT)
          AND co.order_date_create BETWEEN t2.created_at AND t2.created_at + INTERVAL 1 DAY
    )
)
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
    TRY_CAST(co.cust_order_id AS BIGINT)                                AS cust_order_id,
    TRY_CAST(co.customer_account_id AS BIGINT)                          AS customer_account_id,
    co.comments,
    co.comment_on_close,
    CASE WHEN co.cust_order_id IS NOT NULL THEN 1 ELSE 0 END            AS recreated_order
FROM t
LEFT JOIN co_ranked co
    ON CAST(t.customer_id AS BIGINT) = CAST(co.customer_id AS BIGINT)
   AND co.rn = 1
   AND co.order_date_create BETWEEN t.created_at AND t.created_at + INTERVAL 1 DAY
LEFT JOIN crm_customer c
    ON CAST(t.customer_id AS BIGINT) = CAST(c.customer_id AS BIGINT)
ORDER BY t.created_at DESC
