-- Impala (TODAY): детализация заказа из лёгкой crm2.crm2_crm_cust_order_day
-- и справочники (id в name). Pushdown по {{crm_order_id__ids}} из драйвера.
-- В day-таблице меньше полей, чем в drb.drb_iliyas_cust_order_full:
--   order_close_date берём из change_status_date (прокси),
--   username_created_order = create_user (id пользователя, справочника нет).
SELECT
    o.id,
    o.customer_id,
    ot.name                                   AS type_name,
    st.name                                   AS status_name,
    sc.name                                   AS sales_channel_name,
    cast(o.create_date AS timestamp)          AS order_date_create,
    cast(o.change_status_date AS timestamp)   AS order_close_date,
    o.create_user                             AS username_created_order,
    rr.name                                   AS reject_reason_name,
    o.new_product_offer_id,
    po.name                                   AS new_product_offer_name,
    o.customer_account_id,
    o.comments,
    o.comment_on_close
FROM crm2.crm2_crm_cust_order_day o
LEFT JOIN crm2.crm2_crm_cust_order_type     ot ON o.cust_order_type_id = ot.id
LEFT JOIN crm2.crm2_crm_cust_order_status   st ON o.status_id          = st.cust_order_status_id
LEFT JOIN crm_isb.crm2_isb_sales_channel    sc ON o.sales_channel_id   = sc.id
LEFT JOIN crm_isb.crm2_isb_po_reject_reason rr ON o.reject_reason_id   = rr.po_reject_reason_id
LEFT JOIN bimeg_isb.bimeg_isb_product_offer po ON o.new_product_offer_id = po.id
WHERE o.id IN ({{crm_order_id__ids}})
