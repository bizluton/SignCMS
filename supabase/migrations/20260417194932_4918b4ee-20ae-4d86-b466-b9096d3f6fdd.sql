-- Prevent duplicate (user_id, role) pairs; allows multiple distinct roles per user
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_role_unique UNIQUE (user_id, role);

-- Prevent duplicate active/invited records for the same user; allows historical rows of different status
CREATE UNIQUE INDEX cs_agents_user_id_status_unique
  ON public.cs_agents (user_id, status)
  WHERE user_id IS NOT NULL;