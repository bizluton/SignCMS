CREATE POLICY "Users can view own cs_agent record"
ON public.cs_agents
FOR SELECT
TO authenticated
USING (user_id = auth.uid());