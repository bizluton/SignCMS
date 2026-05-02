-- The transcode_status check constraint only allows:
--   ready | pending_transcode | transcoding | failed
-- but the column default was 'none', which violates the constraint and
-- causes widget inserts to fail.
ALTER TABLE public.media_items ALTER COLUMN transcode_status SET DEFAULT 'ready';
