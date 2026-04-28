
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
  OR (
    -- Active CS agents are treated as admin
    _role = 'admin' AND EXISTS (
      SELECT 1
      FROM public.cs_agents
      WHERE user_id = _user_id
        AND status = 'active'
    )
  )
$$;
