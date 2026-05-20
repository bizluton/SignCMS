-- Tighten profiles SELECT visibility — cross-tenant leak fix.
--
-- The original policy "Users can view all profiles" USING (true) leaks
-- every user's display_name + avatar_url across all orgs.
--
-- A user should only see another profile if at least one of:
--   (a) it's their own profile,
--   (b) they're a system admin,
--   (c) they share at least one organization with the target,
--   (d) they have an active (non-expired) delegation_grant with the target
--       in either direction (covers the CS-agent ↔ customer relationship).

-- Helper: does the viewer share an org with the target?
CREATE OR REPLACE FUNCTION public.users_share_org(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.team_members tm1
      JOIN public.teams         t1 ON t1.id = tm1.team_id
      JOIN public.teams         t2 ON t2.org_id = t1.org_id
      JOIN public.team_members  tm2 ON tm2.team_id = t2.id
     WHERE tm1.user_id = _viewer
       AND tm2.user_id = _target
  );
$$;

REVOKE EXECUTE ON FUNCTION public.users_share_org(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.users_share_org(uuid, uuid) TO authenticated;

-- Helper: is there an active (non-expired) delegation between the two users?
CREATE OR REPLACE FUNCTION public.users_have_active_delegation(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.delegation_grants
     WHERE status     = 'active'
       AND expires_at > now()
       AND ((grantor_id = _a AND grantee_id = _b)
         OR (grantor_id = _b AND grantee_id = _a))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.users_have_active_delegation(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.users_have_active_delegation(uuid, uuid) TO authenticated;

-- Replace the open policy.
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view profiles in shared scope"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_system_admin(auth.uid())
    OR public.users_share_org(auth.uid(), user_id)
    OR public.users_have_active_delegation(auth.uid(), user_id)
  );

COMMENT ON POLICY "Users can view profiles in shared scope" ON public.profiles IS
  'Self / system admin / shared-org / active-delegation. Closes the historical "USING (true)" cross-tenant leak.';
