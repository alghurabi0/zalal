-- مؤجل (settled Oct 29, 2026; spec §6): an order put off without a new
-- date. New enum values only, in a migration of their own because Postgres
-- can't use an enum value in the transaction that adds it; the next
-- migration (postponed_orders) uses them.
--
-- - order_status 'postponed', placed after 'confirmed' so it sorts with the
--   open statuses.
-- - notification_type 'customer_postponed' (admins: a customer put an order
--   off) and 'order_postponed' (the customer: staff put it off).

alter type public.order_status add value 'postponed' after 'confirmed';

alter type public.notification_type add value 'order_postponed';
alter type public.notification_type add value 'customer_postponed';
