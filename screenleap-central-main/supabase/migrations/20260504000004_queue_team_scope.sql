-- Allow queues to be scoped to a specific team (optional).
-- team_id = NULL means the queue belongs to the whole org.
ALTER TABLE public.queue_system_queues
  ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX idx_qs_queues_team ON public.queue_system_queues(team_id)
  WHERE team_id IS NOT NULL;
