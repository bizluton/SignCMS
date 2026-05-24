-- AgentManagement page needs to display each agent's email next to their
-- display name. auth.users is not accessible to authenticated role, so we
-- expose a narrow RPC: returns the email for a given user_id, but only when
-- the caller is a system admin. Returns NULL otherwise (no leak via error
-- vs. found-but-null timing differences).

CREATE OR REPLACE FUNCTION public.get_user_email_by_id(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT public.is_system_admin(auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _user_id;
  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_email_by_id(uuid) TO authenticated;
