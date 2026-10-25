-- Local seed data (spec §10.2). `supabase db reset` runs this after the
-- migrations, locally and in CI. Hosted dev and prod never load it: the
-- deploy runs migrations only. So rows a hosted project needs (the settings
-- row, the service area, later prices and slots) come from migrations; this
-- file is for local-only sample data.

-- Service area: comes from migration default_service_area, so hosted
-- projects (which never load this file) have it too.
