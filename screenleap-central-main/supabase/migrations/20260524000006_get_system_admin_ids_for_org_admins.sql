-- Fix: AdminPage calls list_system_admins() to know which users are "protected"
-- (no delete button shown). list_system_admins() raises permission_denied for
-- non-system-admins, so org_admins always receive an empty systemAdminIds set →
-- delete button appears on system admin account rows → click triggers delete-user
-- edge function → 403 "Cannot delete system administrator" is returned but the
-- error body was not parsed in the frontend, showing a generic error instead.
--
-- Fix: expose a minimal read-only function that returns just the user_id list of
-- system admins to any authenticated user. No sensitive fields (is_root, note,
-- added_by) are exposed — only the UUIDs needed to protect the delete button.

CREATE OR REPLACE FUNCTION public.get_system_admin_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT user_id FROM public.system_admins;
$$;

GRANT EXECUTE ON FUNCTION public.get_system_admin_ids() TO authenticated;
