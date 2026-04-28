
CREATE TABLE public.design_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  aspect TEXT NOT NULL DEFAULT '16:9',
  zones JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.design_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own design projects"
  ON public.design_projects FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Users can insert own design projects"
  ON public.design_projects FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own design projects"
  ON public.design_projects FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Users can delete own design projects"
  ON public.design_projects FOR DELETE TO authenticated
  USING (created_by = auth.uid());
