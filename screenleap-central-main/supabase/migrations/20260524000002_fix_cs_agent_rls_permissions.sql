-- #75 P1-NEW-2: Drop overly-broad CS agent UPDATE on organizations
-- #76 P2-NEW-1: Scope CS agent user_roles SELECT to their active orgs
-- #77 P2-NEW-2: Drop CS agent license_codes policies (system_admin route only)

-- ──────────────────────────────────────────────────────────
-- #75: CS agent organizations UPDATE
-- ──────────────────────────────────────────────────────────
-- The policy "CS agents can update org license" allowed CS agents to UPDATE
-- any column on any organizations row. The only page that updates organizations
-- is LicenseManagement.tsx, which is behind SystemAdminRoute — CS agents have
-- no legitimate frontend path. Drop the policy; a future narrowly-scoped RPC
-- should be used if CS agents ever need to update license fields directly.
DROP POLICY IF EXISTS "CS agents can update org license" ON public.organizations;

-- ──────────────────────────────────────────────────────────
-- #76: CS agent user_roles SELECT — scope to relevant orgs
-- ──────────────────────────────────────────────────────────
-- Previous policy allowed any active CS agent to read ALL rows in user_roles
-- (every role assignment in every org). Replace with a scoped policy that
-- limits visibility to:
--   1. The CS agent's own role row.
--   2. Roles for users in orgs where the CS agent has an open assigned session
--      (needed by DelegationDialog to list available org admins while serving
--      a customer in real time).
--   3. Roles for users in orgs where the CS agent holds an active delegation
--      grant.
DROP POLICY IF EXISTS "CS agents can view admin roles" ON public.user_roles;

CREATE POLICY "CS agents can view admin roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    public.is_active_cs_agent(auth.uid())
    AND (
      -- Own row
      user_id = auth.uid()
      -- Orgs with an open session currently assigned to this CS agent
      OR EXISTS (
        SELECT 1
        FROM public.customer_chat_sessions s
        JOIN public.team_members  tm ON tm.user_id = user_roles.user_id
        JOIN public.teams          t  ON t.id = tm.team_id AND t.org_id = s.org_id
        WHERE s.assigned_to = auth.uid()
          AND s.status = 'open'
      )
      -- Orgs where this agent has an active (non-expired) delegation grant
      OR EXISTS (
        SELECT 1
        FROM public.delegation_grants  dg
        JOIN public.team_members  tm_g ON tm_g.user_id = dg.grantor_id
        JOIN public.team_members  tm_t ON tm_t.team_id = tm_g.team_id
                                     AND tm_t.user_id  = user_roles.user_id
        WHERE dg.grantee_id = auth.uid()
          AND dg.status     = 'active'
          AND dg.expires_at > now()
      )
    )
  );

-- ──────────────────────────────────────────────────────────
-- #77: CS agent license_codes policies
-- ──────────────────────────────────────────────────────────
-- license_codes is accessed only from LicenseManagement.tsx and
-- SystemAdminPage.tsx, both guarded by SystemAdminRoute. CS agents have
-- no legitimate path to read or modify license codes.
DROP POLICY IF EXISTS "CS agents can view license_codes"   ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can insert license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can update license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can delete license_codes" ON public.license_codes;
