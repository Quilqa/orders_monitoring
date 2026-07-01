-- Драйвер (Postgre): заказы customer_orders за 2 последних дня (вчера+сегодня, Asia/Almaty).
-- Утром так видно вечерние заказы предыдущего дня.
SELECT
    id,
    customer_id,
    crm_order_id,
    status,
    (created_at AT TIME ZONE 'Asia/Almaty')::timestamp AS created_at
FROM customer_orders
WHERE cast((created_at AT TIME ZONE 'Asia/Almaty') AS date)
      >= (cast((now() AT TIME ZONE 'Asia/Almaty') AS date) - 1)
