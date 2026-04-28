-- 1. Findings storage table
CREATE TABLE IF NOT EXISTS public.security_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  findings_count integer NOT NULL DEFAULT 0,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_findings_run_at
  ON public.security_audit_findings (run_at DESC);

ALTER TABLE public.security_audit_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System admins can view audit findings"
  ON public.security_audit_findings
  FOR SELECT
  TO authenticated
  USING (public.is_system_admin(auth.uid()));

CREATE POLICY "System admins can delete audit findings"
  ON public.security_audit_findings
  FOR DELETE
  TO authenticated
  USING (public.is_system_admin(auth.uid()));

-- 2. Scheduled runner function
CREATE OR REPLACE FUNCTION public.run_security_regression_audit_scheduled()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_ok boolean;
  v_findings jsonb;
  v_count integer;
  v_row_id uuid;
  v_admin_id uuid;
BEGIN
  -- Run the existing audit function
  v_result := public.audit_rls_security_regressions();

  v_ok := COALESCE((v_result->>'ok')::boolean, false);
  v_findings := COALESCE(v_result->'findings', '[]'::jsonb);
  v_count := jsonb_array_length(v_findings);

  -- Persist
  INSERT INTO public.security_audit_findings (ok, findings_count, findings, triggered_by)
  VALUES (v_ok, v_count, v_findings, 'scheduled')
  RETURNING id INTO v_row_id;

  -- Notify system admins on regressions
  IF v_count > 0 THEN
    FOR v_admin_id IN SELECT user_id FROM public.system_admins LOOP
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        v_admin_id,
        'security_alert',
        format('[安全稽核] 偵測到 %s 項 RLS 回歸', v_count),
        '每日自動安全稽核發現新的 RLS / 政策回歸，請至安全稽核頁面查看詳情。',
        '/security-audit'
      );
    END LOOP;

    INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, action_params)
    VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'scheduled_security_audit',
      'security_audit',
      'audit_run',
      v_row_id::text,
      'daily_audit',
      format('Scheduled audit found %s regression(s)', v_count),
      v_result
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'audit_id', v_row_id, 'ok', v_ok, 'count', v_count);
END;
$$;

-- 3. Schedule daily at 03:00 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('daily-security-regression-audit')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-security-regression-audit');
    PERFORM cron.schedule(
      'daily-security-regression-audit',
      '0 3 * * *',
      $cron$ SELECT public.run_security_regression_audit_scheduled(); $cron$
    );
  END IF;
END $$;