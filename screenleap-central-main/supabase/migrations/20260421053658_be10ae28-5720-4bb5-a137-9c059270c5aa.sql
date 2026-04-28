ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
-- Initialize sort_order based on existing creation order, per organization
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at ASC) - 1 AS rn
  FROM public.channels
)
UPDATE public.channels c SET sort_order = r.rn FROM ranked r WHERE r.id = c.id AND c.sort_order = 0;
CREATE INDEX IF NOT EXISTS idx_channels_org_sort ON public.channels (org_id, sort_order);