
-- Fix existing design_projects with NULL org_id by matching creator to their org
UPDATE public.design_projects dp
SET org_id = (
  SELECT t.org_id FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.user_id = dp.created_by
  LIMIT 1
)
WHERE dp.org_id IS NULL
  AND dp.created_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = dp.created_by
  );
