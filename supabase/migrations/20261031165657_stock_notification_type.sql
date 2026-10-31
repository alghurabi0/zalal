-- The low-stock notification (spec §8.3 A23, §9.2; Phase 7, task 6): a new
-- notification_type value for admins. In a migration of its own because
-- Postgres can't use an enum value in the transaction that adds it, and the
-- next migration (finance_stock) puts stock_low in the generated
-- notifications.audience column.

alter type public.notification_type add value 'stock_low';
