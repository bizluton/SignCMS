ALTER TABLE public.screens ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_screens_team_id ON public.screens(team_id);