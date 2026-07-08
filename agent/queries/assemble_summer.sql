-- DuckDB-сборка: summer (Postgre) LEFT JOIN customers (Impala) по customer_id.
SELECT
    s.*,
    c.name,
    c.identification_number,
    c.mobile_phone,
    c.is_check_mobile_phone,
    c.customer_create_date,
    c.has_services
FROM summer s
LEFT JOIN customers c ON s.customer_id = c.customer_id
