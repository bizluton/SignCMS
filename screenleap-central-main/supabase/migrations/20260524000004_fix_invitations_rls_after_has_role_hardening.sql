-- Fix: invitations RLS policies broken by has_role hardening (20260520000010).
--
-- Background:
--   Migration 20260516000003 added `has_role(uid, 'admin') AND user_in_org(uid, org_id)`
--   to the invitations SELECT / INSERT / DELETE policies so that org admins with
--   user_roles.role='admin' (legacy role granted to the first user of each org) could
--   manage invitations.
--
--   Migration 20260520000010 then redefined has_role(uid, 'admin') to be equivalent to
--   is_system_admin(uid), closing a cross-tenant leak.  This unintentionally broke the
--   invitation policies: has_role(uid, 'admin') inside RLS now means "is system admin",
--   so ordinary org admins with user_roles.role='admin' can send invitations via the
--   edge function (which uses service_role) but can no longer READ them back (SELECT is
--   blocked by RLS).
--
-- Fix:
--   Replace the now-broken `has_role(uid, 'admin')` branch with a direct EXISTS check
--   on user_roles for role IN ('admin', 'org_admin'), combined with user_in_org.
--   This restores the intended behaviour without re-opening the cross-tenant leak
--   (the user_in_org() guard ensures org scope is always enforced).

-- SELECT
DROP POLICY IF EXISTS "Admin or org_admin can view invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can view invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (
      user_in_org(auth.uid(), org_id)
      AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role IN ('admin'::app_role, 'org_admin'::app_role)
      )
    )
  );

-- INSERT
DROP POLICY IF EXISTS "Admin or org_admin can insert invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can insert invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR (
      user_in_org(auth.uid(), org_id)
      AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role IN ('admin'::app_role, 'org_admin'::app_role)
      )
    )
  );

-- DELETE
DROP POLICY IF EXISTS "Admin or org_admin can delete invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can delete invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (
      user_in_org(auth.uid(), org_id)
      AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role IN ('admin'::app_role, 'org_admin'::app_role)
      )
    )
  );
