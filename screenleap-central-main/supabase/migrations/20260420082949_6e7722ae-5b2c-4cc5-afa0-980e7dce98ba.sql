-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Audit function: scan all public tables for RLS + admin/CS policy coverage
CREATE OR REPLACE FUNCTION public.audit_rls_coverage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_table record;
  v_policy_count int;
  v_has_priv_policy boolean;
  v_findings jsonb := '[]'::jsonb;
  v_total_checked int := 0;
  v_finding_count int := 0;
  v_reason text;
  v_admin_id uuid;
  -- Tables that intentionally don't need admin/CS-only policies
  -- (org-scoped, user-scoped, or service-role tables)
  v_whitelist text[] := ARRAY[
    'profiles', 'organizations', 'media_items', 'screens', 'schedules',
    'schedule_items', 'schedule_bgm_items', 'design_projects', 'widgets',
    'agent_status', 'notifications', 'activity_logs', 'screen_logs',
    'playback_logs', 'iot_devices', 'iot_sensor_readings', 'team_members',
    'teams', 'user_roles', 'system_admins', 'email_send_log', 'email_send_state',
    'email_unsubscribe_tokens', 'suppressed_emails', 'telegram_bot_state',
    'publish_records'
  ];
BEGIN
  -- Only system admins can run this audit
  IF NOT public.is_system_admin(auth.uid()) AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  FOR v_table IN
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    v_total_checked := v_total_checked + 1;
    v_reason := NULL;

    -- Check 1: RLS must be enabled
    IF NOT v_table.rls_enabled THEN
      v_reason := 'RLS_DISABLED';
    ELSE
      -- Check 2: Skip whitelisted tables for the priv-policy check
      IF NOT (v_table.table_name = ANY(v_whitelist)) THEN
        SELECT COUNT(*),
               bool_or(
                 COALESCE(qual, '') || ' ' || COALESCE(with_check, '') ~*
                 '(has_role|is_system_admin|is_org_admin|is_active_cs_agent)'
               )
          INTO v_policy_count, v_has_priv_policy
          FROM pg_policies
         WHERE schemaname = 'public' AND tablename = v_table.table_name;

        IF v_policy_count = 0 THEN
          v_reason := 'NO_POLICY';
        ELSIF NOT COALESCE(v_has_priv_policy, false) THEN
          v_reason := 'NO_PRIVILEGED_POLICY';
        END IF;
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_finding_count := v_finding_count + 1;
      v_findings := v_findings || jsonb_build_object(
        'table', v_table.table_name,
        'reason', v_reason
      );

      -- Log to activity_logs
      INSERT INTO public.activity_logs (
        user_id, category, action, action_code, target_type, target_name, detail, action_params
      ) VALUES (
        COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
        'security_audit',
        'rls_audit_finding',
        'SECURITY_RLS_GAP',
        'table',
        v_table.table_name,
        format('Table public.%s missing protection: %s', v_table.table_name, v_reason),
        jsonb_build_object('table', v_table.table_name, 'reason', v_reason)
      );
    END IF;
  END LOOP;

  -- Notify all system admins if any findings
  IF v_finding_count > 0 THEN
    FOR v_admin_id IN SELECT user_id FROM public.system_admins
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        v_admin_id,
        'security_alert',
        format('[安全稽核] 發現 %s 個 RLS 缺漏', v_finding_count),
        format('共掃描 %s 張表，%s 張未通過 RLS / 權限政策檢查。請至系統紀錄查看詳情。',
               v_total_checked, v_finding_count),
        '/admin?tab=activity-log'
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checked', v_total_checked,
    'findings', v_finding_count,
    'details', v_findings,
    'audited_at', now()
  );
END;
$$;

-- Restrict execution
REVOKE ALL ON FUNCTION public.audit_rls_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_rls_coverage() TO authenticated, service_role;

-- Schedule daily at 03:00 UTC
SELECT cron.unschedule('audit-rls-coverage-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit-rls-coverage-daily');

SELECT cron.schedule(
  'audit-rls-coverage-daily',
  '0 3 * * *',
  $cron$ SELECT public.audit_rls_coverage(); $cron$
);