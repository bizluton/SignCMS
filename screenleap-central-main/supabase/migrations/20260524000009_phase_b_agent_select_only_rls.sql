-- Phase B: Agent (代理商) SELECT-only RLS across all org-scoped tables.
--
-- Per SIGNCMS組織權限規則: agent has 檢視 (view) access across multiple
-- assigned orgs (set via agent_org_assignments). Same scope as org_admin
-- but read-only — no INSERT / UPDATE / DELETE.
--
-- These policies are ADDITIVE: existing org_admin / system_admin /
-- cs_agent / user policies are untouched. PostgreSQL OR-combines SELECT
-- policies, so agents gain visibility without affecting existing roles.
--
-- We deliberately do NOT add INSERT/UPDATE/DELETE policies for agents.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'activity_logs', 'announcement_categories', 'announcements',
    'channel_blocks', 'channels', 'design_projects', 'device_licenses',
    'installed_widgets', 'invitations', 'iot_devices', 'iot_sensor_readings',
    'knowledge_items', 'license_codes', 'media_items', 'media_tags',
    'notification_log', 'org_installed_apps', 'playback_logs', 'project_schedules',
    'queue_system_configs', 'queue_system_queues', 'screen_activation_codes',
    'screen_alerts', 'screen_footfall_patterns', 'screen_health_report_schedules',
    'screen_logs', 'screens', 'smart_trigger_logs', 'smart_trigger_rules',
    'teams', 'widgets', 'widget_org_exclusions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Agents can view assigned orgs" ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY "Agents can view assigned orgs" ON public.%I '
      'FOR SELECT TO authenticated '
      'USING (public.agent_can_view_org(auth.uid(), org_id))',
      tbl
    );
  END LOOP;
END $$;

-- organizations uses `id` instead of `org_id`
DROP POLICY IF EXISTS "Agents can view assigned organizations" ON public.organizations;
CREATE POLICY "Agents can view assigned organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.agent_can_view_org(auth.uid(), id));

-- team_members uses team_id (need JOIN to teams to get org_id)
DROP POLICY IF EXISTS "Agents can view team_members in assigned orgs" ON public.team_members;
CREATE POLICY "Agents can view team_members in assigned orgs" ON public.team_members
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id
      AND public.agent_can_view_org(auth.uid(), t.org_id)
  ));

-- user_roles: agent can see roles of users in their assigned orgs
DROP POLICY IF EXISTS "Agents can view user_roles in assigned orgs" ON public.user_roles;
CREATE POLICY "Agents can view user_roles in assigned orgs" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    public.is_agent(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = user_roles.user_id
        AND public.agent_can_view_org(auth.uid(), t.org_id)
    )
  );

-- profiles: agent can see profiles of users in their assigned orgs
DROP POLICY IF EXISTS "Agents can view profiles in assigned orgs" ON public.profiles;
CREATE POLICY "Agents can view profiles in assigned orgs" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_agent(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = profiles.user_id
        AND public.agent_can_view_org(auth.uid(), t.org_id)
    )
  );
