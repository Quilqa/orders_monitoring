-- Драйвер (Postgre, БД customer_orders_production). Только customer_orders.
-- created_at приводится к наивному локальному времени (Asia/Almaty),
-- чтобы корректно сравниваться с Impala-таймстемпами в DuckDB-сборке.
SELECT
    id,
    customer_id,
    crm_order_id,
    status,
    (created_at AT TIME ZONE 'Asia/Almaty')::timestamp AS created_at
FROM customer_orders
WHERE cast((created_at AT TIME ZONE 'Asia/Almaty') AS date)
      < cast((now()      AT TIME ZONE 'Asia/Almaty') AS date)
