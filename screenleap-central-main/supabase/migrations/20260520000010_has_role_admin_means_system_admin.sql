-- Close the "global admin bypass" cross-tenant leak.
--
-- Background (audit P1-#10):
--   Many old RLS policies use `has_role(auth.uid(), 'admin')` as an admin
--   override, e.g.
--     USING (has_role(uid, 'admin') OR user_in_org(uid, org_id))
--   The function previously just checked user_roles for role='admin'.
--   Historical sign-up triggers granted that role to the FIRST user of
--   every new organisation (`_is_first := true` in handle_new_user). So
--   every org founder ended up with cross-organisation visibility on
--   17+ tables (screens, media_items, schedules, iot_*, playback_logs, ...).
--
-- The audit's recommended fix is "replace has_role(uid, 'admin') with
-- is_system_admin(uid) everywhere". 220+ call sites across migrations and
-- edge functions — rewriting all of them is brittle.
--
-- This migration takes the equivalent path by redefining the function so
-- that `_role = 'admin'` is treated as "is system admin". The function
-- returns TRUE for the 'admin' role only when the user is in system_admins.
-- Behaviour for other roles (org_admin, cs_agent, user, …) is unchanged.
--
-- Effect on existing users:
--   - System admins (rows in system_admins) keep the access they had.
--   - Legacy org founders who only have user_roles.role='admin' lose their
--     accidental cross-tenant visibility. They still have full access to
--     their own org via the org_admin / user_in_org branches of the same
--     policies.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _role = 'admin'::app_role THEN
    RETURN public.is_system_admin(_user_id);
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role    = _role
  );
END;
$$;

COMMENT ON FUNCTION public.has_role(uuid, app_role) IS
  'Returns true if the user holds the given role. For the legacy "admin" role this is equivalent to is_system_admin() — legacy user_roles.role=admin rows no longer grant cross-tenant access (closes audit P1-#10). Use org_admin for per-org admin checks.';

-- Surface any users who relied on the leaky behaviour so operators can
-- decide case-by-case whether they need to be added to system_admins.
DO $$
DECLARE
  v_legacy int;
BEGIN
  SELECT count(*) INTO v_legacy
    FROM public.user_roles ur
    LEFT JOIN public.system_admins sa ON sa.user_id = ur.user_id
   WHERE ur.role = 'admin' AND sa.user_id IS NULL;

  IF v_legacy > 0 THEN
    RAISE NOTICE
      '[has_role hardening] % user(s) hold legacy user_roles.role=admin but are NOT in system_admins. After this migration they no longer have cross-tenant visibility. Review with: SELECT ur.user_id FROM user_roles ur LEFT JOIN system_admins sa USING (user_id) WHERE ur.role=''admin'' AND sa.user_id IS NULL; — then add genuine sysadmins via INSERT INTO system_admins(user_id) VALUES (?).',
      v_legacy;
  END IF;
END
$$;
