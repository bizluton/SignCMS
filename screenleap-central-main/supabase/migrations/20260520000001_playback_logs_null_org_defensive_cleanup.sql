-- Defensive cleanup for the historical "playback_logs.org_id IS NULL"
-- cross-tenant read leak.
--
-- The original SELECT policy created in 20260322141848 was:
--   USING (has_role(uid, 'admin') OR (org_id IS NULL) OR user_in_org(uid, org_id))
-- combined with seed rows inserted with NULL org_id, that effectively let
-- every authenticated user read the seed rows.
--
-- This was already fixed in:
--   20260417092336 — policy now requires (org_id IS NOT NULL) AND user_in_org(...)
--   20260417093629 — ALTER COLUMN org_id SET NOT NULL
--
-- This migration is defensive only:
--   1. Drops any straggler rows where org_id might still be NULL (idempotent;
--      no-op on environments where the SET NOT NULL migration succeeded).
--   2. Re-asserts the SELECT policy in case any later migration drifted it
--      back to the leaky form.

DELETE FROM public.playback_logs WHERE org_id IS NULL;

DROP POLICY IF EXISTS "Users can view playback logs in their org or admins see all"
  ON public.playback_logs;
DROP POLICY IF EXISTS "Users can view playback logs in their org"
  ON public.playback_logs;

CREATE POLICY "Users can view playback logs in their org"
  ON public.playback_logs FOR SELECT TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id))
  );

COMMENT ON POLICY "Users can view playback logs in their org" ON public.playback_logs IS
  'Restricts SELECT to system admins or org members. Never allow NULL org_id rows to be read (historical cross-tenant leak).';
