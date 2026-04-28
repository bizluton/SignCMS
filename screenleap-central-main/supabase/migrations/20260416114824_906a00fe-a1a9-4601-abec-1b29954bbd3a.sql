
CREATE POLICY "CS agents can insert cs_agents"
  ON public.cs_agents FOR INSERT
  TO authenticated
  WITH CHECK (is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can update cs_agents"
  ON public.cs_agents FOR UPDATE
  TO authenticated
  USING (is_active_cs_agent(auth.uid()))
  WITH CHECK (is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can delete cs_agents"
  ON public.cs_agents FOR DELETE
  TO authenticated
  USING (is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can view cs_agents"
  ON public.cs_agents FOR SELECT
  TO authenticated
  USING (is_active_cs_agent(auth.uid()));
