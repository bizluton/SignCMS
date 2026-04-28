-- Smart trigger rules: shortcuts (manual) and automations (conditional)
CREATE TABLE public.smart_trigger_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'org' CHECK (scope IN ('org', 'screen')),
  screen_id UUID REFERENCES public.screens(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('shortcut', 'automation')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'Zap',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  -- Trigger
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('gpio','remote','api','iot_sensor','webhook','schedule')),
  trigger_key TEXT NOT NULL DEFAULT '',
  trigger_condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Action
  target_design_project_id UUID REFERENCES public.design_projects(id) ON DELETE SET NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  restore_behavior TEXT NOT NULL DEFAULT 'previous' CHECK (restore_behavior IN ('previous','channel','none')),
  restore_channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  cooldown_seconds INTEGER NOT NULL DEFAULT 30,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT screen_scope_requires_screen CHECK (
    (scope = 'org' AND screen_id IS NULL) OR (scope = 'screen' AND screen_id IS NOT NULL)
  )
);

CREATE INDEX idx_smart_trigger_rules_org ON public.smart_trigger_rules(org_id);
CREATE INDEX idx_smart_trigger_rules_screen ON public.smart_trigger_rules(screen_id) WHERE screen_id IS NOT NULL;
CREATE INDEX idx_smart_trigger_rules_enabled ON public.smart_trigger_rules(org_id, enabled) WHERE enabled = true;
CREATE INDEX idx_smart_trigger_rules_lookup ON public.smart_trigger_rules(trigger_source, trigger_key) WHERE enabled = true;

ALTER TABLE public.smart_trigger_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "smart_triggers_select_org" ON public.smart_trigger_rules
  FOR SELECT TO authenticated
  USING (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "smart_triggers_insert_org_admin" ON public.smart_trigger_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    is_system_admin(auth.uid())
    OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)))
  );

CREATE POLICY "smart_triggers_update_org_admin" ON public.smart_trigger_rules
  FOR UPDATE TO authenticated
  USING (
    is_system_admin(auth.uid())
    OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)))
  );

CREATE POLICY "smart_triggers_delete_org_admin" ON public.smart_trigger_rules
  FOR DELETE TO authenticated
  USING (
    is_system_admin(auth.uid())
    OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role)))
  );

CREATE TRIGGER trg_smart_trigger_rules_updated
  BEFORE UPDATE ON public.smart_trigger_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger execution logs
CREATE TABLE public.smart_trigger_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id UUID REFERENCES public.smart_trigger_rules(id) ON DELETE SET NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  screen_id UUID REFERENCES public.screens(id) ON DELETE SET NULL,
  trigger_source TEXT NOT NULL,
  trigger_key TEXT NOT NULL DEFAULT '',
  trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_smart_trigger_logs_org ON public.smart_trigger_logs(org_id, created_at DESC);
CREATE INDEX idx_smart_trigger_logs_rule ON public.smart_trigger_logs(rule_id, created_at DESC) WHERE rule_id IS NOT NULL;

ALTER TABLE public.smart_trigger_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "smart_trigger_logs_select_org" ON public.smart_trigger_logs
  FOR SELECT TO authenticated
  USING (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "smart_trigger_logs_insert_org" ON public.smart_trigger_logs
  FOR INSERT TO authenticated
  WITH CHECK (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "smart_trigger_logs_insert_service" ON public.smart_trigger_logs
  FOR INSERT TO public
  WITH CHECK (auth.role() = 'service_role');