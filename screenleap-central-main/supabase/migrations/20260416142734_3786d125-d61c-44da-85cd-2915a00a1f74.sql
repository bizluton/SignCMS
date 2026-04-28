
-- 1. Fix has_role: remove CS agent admin equivalence
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
$$;

-- 2. Drop the CS agent mutation policies that allow privilege escalation
DROP POLICY IF EXISTS "CS agents can insert cs_agents" ON public.cs_agents;
DROP POLICY IF EXISTS "CS agents can update cs_agents" ON public.cs_agents;
DROP POLICY IF EXISTS "CS agents can delete cs_agents" ON public.cs_agents;
