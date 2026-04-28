ALTER TABLE public.knowledge_categories
  ADD COLUMN IF NOT EXISTS parent_key text NOT NULL DEFAULT 'store';

ALTER TABLE public.knowledge_categories
  ADD CONSTRAINT knowledge_categories_parent_key_check
  CHECK (parent_key IN ('hq', 'store'));

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_parent_key
  ON public.knowledge_categories(parent_key);