-- Forbid base64 data URLs in media_items.url / thumbnail going forward.
-- Legacy base64 has already been migrated to Storage; this prevents regressions.
ALTER TABLE public.media_items
  DROP CONSTRAINT IF EXISTS media_items_no_base64_url,
  DROP CONSTRAINT IF EXISTS media_items_no_base64_thumbnail;

ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_no_base64_url
    CHECK (url IS NULL OR url = '' OR url NOT LIKE 'data:%'),
  ADD CONSTRAINT media_items_no_base64_thumbnail
    CHECK (thumbnail IS NULL OR thumbnail = '' OR thumbnail NOT LIKE 'data:%');