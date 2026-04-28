
-- Protected system admin user ID
-- service@bizlution.com = 3fbb2f97-7268-4cac-a511-7cff6654a8f7

-- Prevent deletion or demotion of the system admin role
CREATE OR REPLACE FUNCTION public.protect_system_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_id = '3fbb2f97-7268-4cac-a511-7cff6654a8f7' AND OLD.role = 'admin' THEN
    RAISE EXCEPTION 'Cannot remove or modify the system administrator role';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER protect_system_admin_role_trigger
BEFORE DELETE OR UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.protect_system_admin_role();

-- Prevent deletion of the system admin profile
CREATE OR REPLACE FUNCTION public.protect_system_admin_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.user_id = '3fbb2f97-7268-4cac-a511-7cff6654a8f7' THEN
    RAISE EXCEPTION 'Cannot delete the system administrator profile';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER protect_system_admin_profile_trigger
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_system_admin_profile();
