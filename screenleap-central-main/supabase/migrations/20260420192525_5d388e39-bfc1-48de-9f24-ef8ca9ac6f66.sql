-- Add default design project to channels
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS default_design_project_id uuid REFERENCES public.design_projects(id) ON DELETE SET NULL;

-- Allowed project list per channel
CREATE TABLE IF NOT EXISTS public.channel_allowed_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  design_project_id uuid NOT NULL REFERENCES public.design_projects(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, design_project_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_allowed_projects_channel ON public.channel_allowed_projects(channel_id);

ALTER TABLE public.channel_allowed_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_allowed_projects_select_org"
  ON public.channel_allowed_projects FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.channels c
    WHERE c.id = channel_allowed_projects.channel_id
      AND (user_in_org(auth.uid(), c.org_id) OR is_system_admin(auth.uid()))));

CREATE POLICY "channel_allowed_projects_modify_org_admin"
  ON public.channel_allowed_projects FOR ALL
  USING (EXISTS (SELECT 1 FROM public.channels c
    WHERE c.id = channel_allowed_projects.channel_id
      AND user_in_org(auth.uid(), c.org_id)
      AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.channels c
    WHERE c.id = channel_allowed_projects.channel_id
      AND user_in_org(auth.uid(), c.org_id)
      AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))));