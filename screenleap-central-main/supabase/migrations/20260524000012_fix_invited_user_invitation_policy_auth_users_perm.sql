-- The "Invited user can read own invitation" SELECT policy on invitations
-- queried auth.users.email directly via subquery:
--
--   USING (lower(email) = lower(
--     (SELECT users.email FROM auth.users WHERE users.id = auth.uid())::text
--   ))
--
-- The `authenticated` role does NOT have SELECT on auth.users, so this
-- subquery raises ERROR 42501 "permission denied for table users". When
-- ANY RLS policy raises an exception, PostgREST returns 403 for the whole
-- query — even if other PERMISSIVE policies would have allowed the row.
--
-- That meant the system admin (covered by a different policy) was also
-- being blocked from selecting invitations, because policy evaluation
-- failed before the other policies got their turn. This is what caused
-- the InvitationManagement page to show 0 invitations for system admins
-- even though both policies (admin + invited-user) and the DB rows are
-- present and correct.
--
-- Fix: replace the auth.users subquery with auth.jwt() ->> 'email', which
-- reads from the request's JWT claims without needing table access.

DROP POLICY IF EXISTS "Invited user can read own invitation" ON public.invitations;

CREATE POLICY "Invited user can read own invitation" ON public.invitations
  FOR SELECT TO authenticated
  USING (
    lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
  );
