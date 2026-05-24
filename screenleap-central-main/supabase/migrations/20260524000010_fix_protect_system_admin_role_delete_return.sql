-- CRITICAL bug fix: protect_system_admin_role() was returning NEW unconditionally.
-- For a BEFORE DELETE trigger, NEW is NULL → returning NULL silently cancels the
-- DELETE without raising an error. This caused user_roles deletes to fail silently
-- across the system:
--   - delete-user edge function's `DELETE FROM user_roles WHERE user_id = ?`
--     completed without affecting any rows, leaving orphan role rows.
--   - handleRoleChange (DELETE + INSERT pattern) failed at the DELETE step,
--     producing duplicate role rows or stuck state.
--   - When this session deleted Roger, his user_roles rows survived as orphans
--     (user_id with no matching auth.users row).
--
-- Fix:
--   - BEFORE DELETE must return OLD (returning NULL silently aborts the row).
--   - While we're here, align the protection rule with SIGNCMS組織權限規則:
--     protect ALL is_root system admins, not just a hardcoded UUID.

CREATE OR REPLACE FUNCTION public.protect_system_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Block demoting any root system admin (原生管理員 per the rules doc).
  IF OLD.role = 'admin' AND EXISTS (
    SELECT 1 FROM public.system_admins
    WHERE user_id = OLD.user_id AND is_root = true
  ) THEN
    RAISE EXCEPTION 'Cannot remove or modify the role of a root system administrator';
  END IF;

  -- Critical: BEFORE DELETE must return OLD (returning NULL silently aborts).
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
