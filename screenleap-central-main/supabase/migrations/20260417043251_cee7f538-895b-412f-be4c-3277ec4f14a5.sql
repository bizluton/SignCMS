-- Allow active CS agents to manage license codes (in addition to system admin)
DROP POLICY IF EXISTS "CS agents can view license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can insert license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can update license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can delete license_codes" ON public.license_codes;

CREATE POLICY "CS agents can view license_codes" ON public.license_codes
  FOR SELECT TO authenticated USING (public.is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can insert license_codes" ON public.license_codes
  FOR INSERT TO authenticated WITH CHECK (public.is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can update license_codes" ON public.license_codes
  FOR UPDATE TO authenticated USING (public.is_active_cs_agent(auth.uid())) WITH CHECK (public.is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can delete license_codes" ON public.license_codes
  FOR DELETE TO authenticated USING (public.is_active_cs_agent(auth.uid()));

-- Allow CS agents to view all organizations (for license management table)
DROP POLICY IF EXISTS "CS agents can view organizations" ON public.organizations;
CREATE POLICY "CS agents can view organizations" ON public.organizations
  FOR SELECT TO authenticated USING (public.is_active_cs_agent(auth.uid()));

-- Allow CS agents to update org license expiry
DROP POLICY IF EXISTS "CS agents can update org license" ON public.organizations;
CREATE POLICY "CS agents can update org license" ON public.organizations
  FOR UPDATE TO authenticated USING (public.is_active_cs_agent(auth.uid())) WITH CHECK (public.is_active_cs_agent(auth.uid()));