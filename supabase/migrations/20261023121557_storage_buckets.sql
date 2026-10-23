-- Storage buckets (spec §7). Created here rather than in the dashboard or in
-- config.toml, so local, dev and prod get the same buckets from one source.
--
-- Access: no storage.objects policies yet, so only the service role can read
-- or write these buckets. Each later phase adds the policies for its bucket
-- next to the tables that own the files (orders, chat, tickets, certificates,
-- articles), with pgTAP tests.
--
-- Departure from spec §7: each bucket also has a size cap and a file-type
-- allow-list, so Storage itself refuses files the app would never send.
--
-- Size caps follow the spec (videos up to 100 MB, §5.10; chat and issue
-- attachments use the same limits, §5.16 and §5.17). Note: the Supabase Free
-- plan caps every upload at 50 MB project-wide, whatever the bucket says, so on
-- a Free project files over 50 MB are refused until it moves to Pro.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Customer booking photos/videos, crew before/after photos and clips.
  (
    'order-media', 'order-media', false, 104857600,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
  ),
  -- Chat attachments: same limits as booking uploads (spec §5.16).
  (
    'chat-media', 'chat-media', false, 104857600,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
  ),
  -- Issue report attachments: same limits as booking uploads (spec §5.17).
  (
    'ticket-media', 'ticket-media', false, 104857600,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
  ),
  -- Generated certificate PDFs (spec §10.1): one A4 page with a few thumbnails.
  ('certificates', 'certificates', false, 10485760, array['application/pdf']),
  -- Article covers; public so the Tips pages can use plain URLs (spec §7).
  (
    'public-content', 'public-content', true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
