-- Extensions the app needs, enabled here so local, dev and prod always match
-- (docs/supabase-setup.md step 3: never enable them in the dashboard).
--
-- pgTAP is not here on purpose: only the tests load it (supabase/tests), so it
-- never reaches prod.

-- PostGIS: service-area check with ST_Contains and crew distance (spec §3, §9.3).
-- Kept in the `extensions` schema, as Supabase recommends, so its many
-- functions and the spatial_ref_sys table stay out of the public API.
create extension if not exists postgis with schema extensions;

-- pg_cron: scheduled jobs such as reminders, subscription expiry and
-- stale-slot cleanup (spec §3, §9.2). It always installs into pg_catalog and
-- creates the `cron` schema.
create extension if not exists pg_cron with schema pg_catalog;

-- pg_net: async HTTP from Postgres, used by triggers and cron jobs to call Edge
-- Functions such as send-push (spec §9.2). It always creates the `net` schema.
create extension if not exists pg_net with schema extensions;
