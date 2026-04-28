-- Add team_id and collab_scope to channels
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collab_scope text NOT NULL DEFAULT 'team';

ALTER TABLE public.channels
  ADD CONSTRAINT channels_collab_scope_check
  CHECK (collab_scope IN ('creator', 'team', 'org'));

CREATE INDEX IF NOT EXISTS idx_channels_team_id ON public.channels(team_id);

-- Replace the SELECT policy to honor collab_scope + team_id
DROP POLICY IF EXISTS channels_select_org ON public.channels;

CREATE POLICY channels_select_org ON public.channels
FOR SELECT
TO public
USING (
  is_system_admin(auth.uid())
  OR (
    user_in_org(auth.uid(), org_id) AND (
      is_org_admin(auth.uid())
      OR created_by = auth.uid()
      OR collab_scope = 'org'
      OR (
        collab_scope = 'team'
        AND team_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = channels.team_id
            AND tm.user_id = auth.uid()
        )
      )
    )
  )
);