ALTER TABLE public.schedule_items
  ALTER COLUMN media_id DROP NOT NULL,
  ADD COLUMN design_project_id UUID REFERENCES public.design_projects(id) ON DELETE SET NULL,
  ADD COLUMN item_type TEXT NOT NULL DEFAULT 'media';

COMMENT ON COLUMN public.schedule_items.item_type IS 'media or design_project';