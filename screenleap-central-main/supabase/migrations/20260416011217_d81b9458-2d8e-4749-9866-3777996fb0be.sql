-- Drop and recreate UPDATE policy with proper WITH CHECK
DROP POLICY IF EXISTS "System admin can update cs_agents" ON public.cs_agents;
CREATE POLICY "System admin can update cs_agents"
  ON public.cs_agents FOR UPDATE TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid)
  WITH CHECK (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

-- Also add a broader admin SELECT policy to ensure .select() after .insert() works
DROP POLICY IF EXISTS "Admins can view cs_agents" ON public.cs_agents;
CREATE POLICY "Admins can view cs_agents"
  ON public.cs_agents FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));