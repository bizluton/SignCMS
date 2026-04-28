-- Tighten realtime topic scoping: drop the blanket "realtime:%" allowance
-- so users cannot subscribe to other users' topics (chat sessions, delegations, etc.)
DROP POLICY IF EXISTS "Users can subscribe to their own or postgres_changes topics" ON realtime.messages;

CREATE POLICY "Users can subscribe to scoped topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_org_admin(auth.uid())
  OR public.is_active_cs_agent(auth.uid())
  OR realtime.topic() LIKE '%' || (auth.uid())::text || '%'
);

-- Extend the regression audit to assert the wildcard is gone
CREATE OR REPLACE FUNCTION public.audit_rls_security_regressions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_pol record;
  v_ok boolean;
  v_func record;
BEGIN
  IF NOT public.is_system_admin(auth.uid()) AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- knowledge_tags UPDATE: must reference a privilege/ownership check
  v_ok := false;
  FOR v_pol IN
    SELECT pg_get_expr(polqual, polrelid) AS qual,
           pg_get_expr(polwithcheck, polrelid) AS wcheck
    FROM pg_policy
    WHERE polrelid = 'public.knowledge_tags'::regclass AND polcmd = 'w'
  LOOP
    IF COALESCE(v_pol.qual,'') || ' ' || COALESCE(v_pol.wcheck,'') ~* '(has_role|is_system_admin|is_org_admin|is_active_cs_agent|created_by)' THEN
      v_ok := true;
    END IF;
  END LOOP;
  IF NOT v_ok THEN
    v_findings := v_findings || jsonb_build_object('id','KNOWLEDGE_TAGS_UPDATE_PERMISSIVE');
  END IF;

  -- screen_logs SELECT: must NOT permit org_id IS NULL to non-admin
  FOR v_pol IN
    SELECT polname, pg_get_expr(polqual, polrelid) AS qual
    FROM pg_policy
    WHERE polrelid = 'public.screen_logs'::regclass AND polcmd = 'r'
  LOOP
    IF v_pol.qual ~* 'org_id\s+is\s+null' AND v_pol.qual !~* '(is_system_admin|has_role)' THEN
      v_findings := v_findings || jsonb_build_object('id','SCREEN_LOGS_NULL_ORG_LEAK','policy',v_pol.polname);
    END IF;
  END LOOP;

  -- realtime.messages: SELECT must include topic scoping and NOT the broad realtime:% wildcard
  v_ok := false;
  FOR v_pol IN
    SELECT polname, pg_get_expr(polqual, polrelid) AS qual
    FROM pg_policy
    WHERE polrelid = 'realtime.messages'::regclass AND polcmd = 'r'
  LOOP
    IF v_pol.qual ~* 'realtime:%' THEN
      v_findings := v_findings || jsonb_build_object('id','REALTIME_WILDCARD_TOPIC','policy',v_pol.polname);
    END IF;
    IF v_pol.qual ~* 'auth\.uid' AND v_pol.qual ~* 'topic' THEN
      v_ok := true;
    END IF;
    IF v_pol.qual = 'true' THEN
      v_findings := v_findings || jsonb_build_object('id','REALTIME_SELECT_TRUE','policy',v_pol.polname);
    END IF;
  END LOOP;
  IF NOT v_ok THEN
    v_findings := v_findings || jsonb_build_object('id','REALTIME_SELECT_NOT_USER_SCOPED');
  END IF;

  -- realtime.messages INSERT (broadcast) must also be scoped
  FOR v_pol IN
    SELECT polname, pg_get_expr(polwithcheck, polrelid) AS wcheck
    FROM pg_policy
    WHERE polrelid = 'realtime.messages'::regclass AND polcmd = 'a'
  LOOP
    IF v_pol.wcheck = 'true' THEN
      v_findings := v_findings || jsonb_build_object('id','REALTIME_BROADCAST_TRUE','policy',v_pol.polname);
    END IF;
  END LOOP;

  -- get_plan_limits search_path
  SELECT proconfig AS config INTO v_func
  FROM pg_proc WHERE oid = 'public.get_plan_limits(public.plan_tier)'::regprocedure;
  IF v_func.config IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_func.config) c WHERE c ILIKE 'search_path=%') THEN
    v_findings := v_findings || jsonb_build_object('id','GET_PLAN_LIMITS_NO_SEARCH_PATH');
  END IF;

  IF jsonb_array_length(v_findings) > 0 THEN
    INSERT INTO public.activity_logs (user_id, category, action, action_code, target_type, target_name, detail, action_params)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'security_audit', 'rls_regression', 'SECURITY_REGRESSION',
      'policies', 'realtime+rls',
      format('Detected %s security regression(s)', jsonb_array_length(v_findings)),
      jsonb_build_object('findings', v_findings)
    );
  END IF;

  RETURN jsonb_build_object('checked_at', now(), 'findings', v_findings, 'ok', jsonb_array_length(v_findings) = 0);
END;
$$;