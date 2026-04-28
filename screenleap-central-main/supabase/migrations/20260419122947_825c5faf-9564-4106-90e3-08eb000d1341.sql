-- 1. Schedule volume column (0-100, default 30)
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS bgm_volume integer NOT NULL DEFAULT 30
    CHECK (bgm_volume >= 0 AND bgm_volume <= 100);

-- 2. BGM playlist items (ordered list of audio tracks per schedule)
CREATE TABLE IF NOT EXISTS public.schedule_bgm_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.media_items(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_bgm_items_schedule
  ON public.schedule_bgm_items(schedule_id, sort_order);

ALTER TABLE public.schedule_bgm_items ENABLE ROW LEVEL SECURITY;

-- View: anyone who can see the schedule can see its BGM list
CREATE POLICY "View bgm items for accessible schedules"
ON public.schedule_bgm_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_bgm_items.schedule_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR (s.org_id IS NOT NULL AND public.user_in_org(auth.uid(), s.org_id))
      )
  )
);

-- Insert: org members or admins
CREATE POLICY "Insert bgm items for own org schedules"
ON public.schedule_bgm_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_bgm_items.schedule_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR (s.org_id IS NOT NULL AND public.user_in_org(auth.uid(), s.org_id))
      )
  )
);

-- Update
CREATE POLICY "Update bgm items for own org schedules"
ON public.schedule_bgm_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_bgm_items.schedule_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR (s.org_id IS NOT NULL AND public.user_in_org(auth.uid(), s.org_id))
      )
  )
);

-- Delete
CREATE POLICY "Delete bgm items for own org schedules"
ON public.schedule_bgm_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_bgm_items.schedule_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR (s.org_id IS NOT NULL AND public.user_in_org(auth.uid(), s.org_id))
      )
  )
);