ALTER TABLE public.knowledge_tags ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_knowledge_tags_sort_order ON public.knowledge_tags(sort_order);

-- Initialize sort_order based on current alphabetical name ordering
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) - 1 AS rn
  FROM public.knowledge_tags
)
UPDATE public.knowledge_tags t SET sort_order = ranked.rn
FROM ranked WHERE ranked.id = t.id;