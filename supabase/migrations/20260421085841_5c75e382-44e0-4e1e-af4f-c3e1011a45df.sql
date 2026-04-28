CREATE OR REPLACE FUNCTION public.audit_rls_security_regressions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_count int := 0;
  v_pol record;
  v_func record;
  v_ok boolean;
  v_qual text;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.is_system_admin(auth.uid()) AND auth.role() <> 'service_role') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- 1. knowledge_tags UPDATE: must reference a privilege check, must not be permissive-true
  v_ok := false;
  FOR v_pol IN
    SELECT policyname AS polname, qual AS qual_text, with_check AS check_text
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_tags' AND cmd = 'UPDATE'
  LOOP
    v_qual := COALESCE(v_pol.qual_text, '') || ' ' || COALESCE(v_pol.check_text, '');
    IF v_qual ~* '(has_role|is_system_admin|is_org_admin|is_active_cs_agent|created_by)' THEN
      v_ok := true;
    END IF;
    IF btrim(v_qual) ~* '^\(?true\)?$' THEN
      v_findings := v_findings || jsonb_build_object(
        'id', 'KNOWLEDGE_TAGS_UPDATE_OPEN',
        'detail', format('knowledge_tags UPDATE policy %s has a permissive true clause', v_pol.polname)
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  IF NOT v_ok THEN
    v_findings := v_findings || jsonb_build_object(
      'id', 'KNOWLEDGE_TAGS_UPDATE_MISSING_PRIV',
      'detail', 'No knowledge_tags UPDATE policy references creator/admin/org_admin/CS-agent check'
    );
    v_count := v_count + 1;
  END IF;

  -- 2. screen_logs SELECT: no policy may grant access to org_id IS NULL rows for non-admins
  FOR v_pol IN
    SELECT policyname AS polname, qual AS qual_text
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'screen_logs' AND cmd = 'SELECT'
  LOOP
    IF COALESCE(v_pol.qual_text, '') ~* 'org_id\s+IS\s+NULL'
       AND COALESCE(v_pol.qual_text, '') !~* '(is_system_admin|has_role)' THEN
      v_findings := v_findings || jsonb_build_object(
        'id', 'SCREEN_LOGS_NULL_ORG_LEAK',
        'detail', format('screen_logs SELECT policy %s exposes rows with org_id IS NULL', v_pol.polname)
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- 3. realtime.messages SELECT: must not be blanket true; must require uid/topic/privilege check
  v_ok := false;
  FOR v_pol IN
    SELECT policyname AS polname, qual AS qual_text
    FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages' AND cmd = 'SELECT'
  LOOP
    v_qual := COALESCE(v_pol.qual_text, '');
    IF btrim(v_qual) ~* '^\(?true\)?$' THEN
      v_findings := v_findings || jsonb_build_object(
        'id', 'REALTIME_MESSAGES_OPEN',
        'detail', format('realtime.messages SELECT policy %s is permissive-true', v_pol.polname)
      );
      v_count := v_count + 1;
    END IF;
    IF v_qual ~* '(auth\.uid|is_system_admin|is_org_admin|is_active_cs_agent|has_role)' THEN
      v_ok := true;
    END IF;
  END LOOP;
  IF NOT v_ok THEN
    v_findings := v_findings || jsonb_build_object(
      'id', 'REALTIME_MESSAGES_MISSING_SCOPE',
      'detail', 'No realtime.messages SELECT policy references auth.uid() or a privilege check'
    );
    v_count := v_count + 1;
  END IF;

  -- 4. get_plan_limits must have an explicit search_path setting
  SELECT p.proname,
         COALESCE(array_to_string(p.proconfig, ' '), '') AS config
    INTO v_func
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_plan_limits'
   LIMIT 1;
  IF v_func.proname IS NULL THEN
    v_findings := v_findings || jsonb_build_object(
      'id', 'GET_PLAN_LIMITS_MISSING',
      'detail', 'public.get_plan_limits function not found'
    );
    v_count := v_count + 1;
  ELSIF v_func.config !~* 'search_path' THEN
    v_findings := v_findings || jsonb_build_object(
      'id', 'GET_PLAN_LIMITS_NO_SEARCH_PATH',
      'detail', 'public.get_plan_limits has no explicit search_path'
    );
    v_count := v_count + 1;
  END IF;

  IF v_count > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, category, action, action_code, target_type, target_name, detail, action_params
    ) VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'security_audit',
      'rls_regression_finding',
      'SECURITY_RLS_REGRESSION',
      'policy_set',
      'sensitive_rls',
      format('Detected %s RLS security regression(s)', v_count),
      jsonb_build_object('findings', v_findings)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', v_count = 0,
    'count', v_count,
    'findings', v_findings,
    'audited_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_rls_security_regressions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_rls_security_regressions() TO authenticated, service_role;