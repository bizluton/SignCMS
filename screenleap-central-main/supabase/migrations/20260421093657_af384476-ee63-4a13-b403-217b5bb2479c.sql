-- 1. Add pinned column
ALTER TABLE public.security_audit_findings
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_security_audit_findings_pinned_run_at
  ON public.security_audit_findings (pinned, run_at);

-- 2. Allow system admins to UPDATE (to toggle pinned)
DROP POLICY IF EXISTS "System admins can update findings" ON public.security_audit_findings;
CREATE POLICY "System admins can update findings"
  ON public.security_audit_findings
  FOR UPDATE
  TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

-- 3. Prune function: deletes unpinned findings older than 90 days
CREATE OR REPLACE FUNCTION public.prune_security_audit_findings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH del AS (
    DELETE FROM public.security_audit_findings
    WHERE pinned = false
      AND run_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  IF v_deleted > 0 THEN
    INSERT INTO public.activity_logs (user_id, action, action_code, category, target_type, target_name, detail, action_params)
    VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'prune_security_audit_findings',
      'SECURITY_AUDIT_PRUNED',
      'security_audit',
      'security_audit_findings',
      'retention_90d',
      format('Pruned %s unpinned audit finding row(s) older than 90 days', v_deleted),
      jsonb_build_object('deleted', v_deleted, 'retention_days', 90)
    );
  END IF;

  RETURN jsonb_build_object('deleted', v_deleted, 'pruned_at', now());
END;
$$;

-- 4. Schedule daily at 03:30 UTC (30 min after audit run)
DO $$
BEGIN
  PERFORM cron.unschedule('prune-security-audit-findings');
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'prune-security-audit-findings',
  '30 3 * * *',
  $$SELECT public.prune_security_audit_findings();$$
);