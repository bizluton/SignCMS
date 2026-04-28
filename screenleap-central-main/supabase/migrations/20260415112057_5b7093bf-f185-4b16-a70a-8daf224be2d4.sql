
-- Agent status table
CREATE TABLE public.agent_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'available',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all agent statuses"
ON public.agent_status FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can insert own status"
ON public.agent_status FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own status"
ON public.agent_status FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Update auto-assign function to skip busy agents
CREATE OR REPLACE FUNCTION public.auto_assign_chat_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _agent_id uuid;
BEGIN
  IF NEW.assigned_to IS NOT NULL OR NEW.status != 'open' THEN
    RETURN NEW;
  END IF;

  SELECT ur.user_id INTO _agent_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_status ast
      WHERE ast.user_id = ur.user_id AND ast.status = 'busy'
    )
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
