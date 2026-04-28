
-- Add assigned_to column to customer_chat_sessions
ALTER TABLE public.customer_chat_sessions
ADD COLUMN assigned_to uuid DEFAULT NULL;

-- Create auto-assign function: picks the admin with fewest open sessions
CREATE OR REPLACE FUNCTION public.auto_assign_chat_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _agent_id uuid;
BEGIN
  -- Only auto-assign if not already assigned and session is open
  IF NEW.assigned_to IS NOT NULL OR NEW.status != 'open' THEN
    RETURN NEW;
  END IF;

  -- Find the admin with the fewest currently open assigned sessions
  SELECT ur.user_id INTO _agent_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY (
    SELECT count(*)
    FROM public.customer_chat_sessions s
    WHERE s.assigned_to = ur.user_id AND s.status = 'open'
  ) ASC
  LIMIT 1;

  IF _agent_id IS NOT NULL THEN
    NEW.assigned_to := _agent_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for auto-assignment on new sessions
CREATE TRIGGER trg_auto_assign_chat_session
BEFORE INSERT ON public.customer_chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_chat_session();
