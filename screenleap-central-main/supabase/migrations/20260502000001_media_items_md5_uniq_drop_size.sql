-- Images uploaded after the WebP optimization feature are stored at a
-- different size_bytes than the original. Drop the (org_id, md5, size_bytes)
-- unique index and replace it with (org_id, md5) so dedup works regardless
-- of the stored format.

DROP INDEX IF EXISTS public.media_items_org_md5_size_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS media_items_org_md5_uniq
  ON public.media_items (org_id, md5)
  WHERE md5 IS NOT NULL;
