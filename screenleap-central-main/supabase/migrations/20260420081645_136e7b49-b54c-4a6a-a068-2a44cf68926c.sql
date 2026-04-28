CREATE OR REPLACE FUNCTION public.enforce_role_mutual_exclusion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block inserting org_admin if user is already admin
  IF NEW.role = 'org_admin' THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = NEW.user_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'role_conflict: user already has admin role; org_admin is redundant'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- When granting admin, auto-remove redundant org_admin (admin supersedes)
  IF NEW.role = 'admin' THEN
    DELETE FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'org_admin';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_role_mutual_exclusion ON public.user_roles;
CREATE TRIGGER trg_enforce_role_mutual_exclusion
BEFORE INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_role_mutual_exclusion();