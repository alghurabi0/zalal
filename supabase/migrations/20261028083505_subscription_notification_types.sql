-- The subscription notifications (spec §9.2; Phase 6, task 2): new
-- notification_type values. In a migration of their own because Postgres
-- can't use an enum value in the transaction that adds it, and the next
-- migration (subscriptions) puts subscription_requested in the generated
-- notifications.audience column.

alter type public.notification_type add value 'subscription_activated';
alter type public.notification_type add value 'subscription_declined';
alter type public.notification_type add value 'subscription_expiring';
alter type public.notification_type add value 'subscription_requested';
