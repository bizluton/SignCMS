
CREATE OR REPLACE FUNCTION public.handle_cs_agent_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cs_agent_id uuid;
BEGIN
  _cs_agent_id := (NEW.raw_user_meta_data ->> 'cs_agent')::uuid;
  IF _cs_agent_id IS NOT NULL THEN
    UPDATE public.cs_agents
    SET user_id = NEW.id,
        status = 'active',
        updated_at = now()
    WHERE id = _cs_agent_id
      AND status = 'invited';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_link_cs_agent ON auth.users;
CREATE TRIGGER on_auth_user_created_link_cs_agent
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_cs_agent_signup();
