-- 1. 螢幕對組織規則的覆寫表（用於停用繼承的組織規則）
CREATE TABLE public.screen_smart_trigger_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id UUID NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.smart_trigger_rules(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (screen_id, rule_id)
);

CREATE INDEX idx_sst_overrides_screen ON public.screen_smart_trigger_overrides(screen_id);
CREATE INDEX idx_sst_overrides_rule ON public.screen_smart_trigger_overrides(rule_id);

ALTER TABLE public.screen_smart_trigger_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sst_overrides_select_org" ON public.screen_smart_trigger_overrides
  FOR SELECT USING (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM screens s
      WHERE s.id = screen_smart_trigger_overrides.screen_id
        AND user_in_org(auth.uid(), s.org_id)
    )
  );

CREATE POLICY "sst_overrides_modify_org_admin" ON public.screen_smart_trigger_overrides
  FOR ALL USING (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM screens s
      WHERE s.id = screen_smart_trigger_overrides.screen_id
        AND user_in_org(auth.uid(), s.org_id)
        AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
    )
  ) WITH CHECK (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM screens s
      WHERE s.id = screen_smart_trigger_overrides.screen_id
        AND user_in_org(auth.uid(), s.org_id)
        AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE TRIGGER trg_sst_overrides_updated_at
  BEFORE UPDATE ON public.screen_smart_trigger_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. 螢幕專屬規則的多對多關聯表
CREATE TABLE public.screen_smart_trigger_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id UUID NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.smart_trigger_rules(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  UNIQUE (screen_id, rule_id)
);

CREATE INDEX idx_sst_rules_screen ON public.screen_smart_trigger_rules(screen_id);
CREATE INDEX idx_sst_rules_rule ON public.screen_smart_trigger_rules(rule_id);

ALTER TABLE public.screen_smart_trigger_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sst_rules_select_org" ON public.screen_smart_trigger_rules
  FOR SELECT USING (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM screens s
      WHERE s.id = screen_smart_trigger_rules.screen_id
        AND user_in_org(auth.uid(), s.org_id)
    )
  );

CREATE POLICY "sst_rules_modify_org_admin" ON public.screen_smart_trigger_rules
  FOR ALL USING (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM screens s
      WHERE s.id = screen_smart_trigger_rules.screen_id
        AND user_in_org(auth.uid(), s.org_id)
        AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
    )
  ) WITH CHECK (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM screens s
      WHERE s.id = screen_smart_trigger_rules.screen_id
        AND user_in_org(auth.uid(), s.org_id)
        AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
    )
  );