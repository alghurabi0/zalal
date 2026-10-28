-- Local seed data (spec §10.2). `supabase db reset` runs this after the
-- migrations, locally and in CI. Hosted dev and prod never load it: the
-- deploy runs migrations only. So rows a hosted project needs (the settings
-- row, the service area, later prices and slots) come from migrations; this
-- file is for local-only sample data.

-- Service area: comes from migration default_service_area, so hosted
-- projects (which never load this file) have it too.

-- Articles: the categories and the six articles come from migration
-- articles as drafts (the owner reviews them before they show on prod).
-- Locally they are published, a day apart and newest first in the Tips
-- canvas's order, so Tips, Article and Home have content to show.
update public.articles as a
set status = 'published',
  published_at = now() - (v.days_ago * interval '1 day')
from (
  values
    ('tank-cleaning-signs', 1),
    ('clean-every-six-months', 2),
    ('summer-heat-bacteria', 3),
    ('tank-lid', 4),
    ('cleaning-visit', 5),
    ('chlorine-smell', 6)
) as v (slug, days_ago)
where a.slug = v.slug and a.status = 'draft';
