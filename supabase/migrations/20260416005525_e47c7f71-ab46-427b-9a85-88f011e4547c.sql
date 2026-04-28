-- Create cs_agents table
CREATE TABLE public.cs_agents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'invited',
  invited_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(email)
);

-- Enable RLS
ALTER TABLE public.cs_agents ENABLE ROW LEVEL SECURITY;

-- Only system admin can manage CS agents
CREATE POLICY "System admin can insert cs_agents"
  ON public.cs_agents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

CREATE POLICY "System admin can update cs_agents"
  ON public.cs_agents FOR UPDATE TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

CREATE POLICY "System admin can delete cs_agents"
  ON public.cs_agents FOR DELETE TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

-- All admins can view cs agents list
CREATE POLICY "Admins can view cs_agents"
  ON public.cs_agents FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_cs_agents_updated_at
  BEFORE UPDATE ON public.cs_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();