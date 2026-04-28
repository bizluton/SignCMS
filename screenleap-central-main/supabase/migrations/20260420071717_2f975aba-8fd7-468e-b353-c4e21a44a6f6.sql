
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS duration_seconds numeric(10,3);

COMMENT ON COLUMN public.media_items.width IS 'Pixel width (image/video). Replaces text `dimensions` left side.';
COMMENT ON COLUMN public.media_items.height IS 'Pixel height (image/video). Replaces text `dimensions` right side.';
COMMENT ON COLUMN public.media_items.duration_seconds IS 'Duration in seconds (video/audio). Replaces text `duration` (mm:ss).';

-- Backfill width/height from "WxH" or "W×H" patterns
UPDATE public.media_items
SET width = NULLIF(split_part(regexp_replace(dimensions, '[xX×]', '×'), '×', 1), '')::int,
    height = NULLIF(split_part(regexp_replace(dimensions, '[xX×]', '×'), '×', 2), '')::int
WHERE dimensions IS NOT NULL
  AND dimensions ~ '^\s*\d+\s*[xX×]\s*\d+\s*$'
  AND (width IS NULL OR height IS NULL);

-- Backfill duration_seconds from "M:SS" / "MM:SS" / "H:MM:SS"
UPDATE public.media_items
SET duration_seconds = CASE
  WHEN duration ~ '^\d+:\d{2}:\d{2}$' THEN
    (split_part(duration, ':', 1)::int * 3600
   + split_part(duration, ':', 2)::int * 60
   + split_part(duration, ':', 3)::int)::numeric
  WHEN duration ~ '^\d+:\d{2}$' THEN
    (split_part(duration, ':', 1)::int * 60
   + split_part(duration, ':', 2)::int)::numeric
  WHEN duration ~ '^\d+(\.\d+)?$' THEN
    duration::numeric
  ELSE NULL
END
WHERE duration IS NOT NULL
  AND duration <> ''
  AND duration_seconds IS NULL;
