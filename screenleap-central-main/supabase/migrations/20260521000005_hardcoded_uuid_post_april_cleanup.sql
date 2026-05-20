-- Final cleanup for the hardcoded system-admin UUID
-- (3fbb2f97-7268-4cac-a511-7cff6654a8f7).
--
-- Migration 20260420011350 (April 2026) already:
--   1. Rewrote 5 SECURITY DEFINER RPCs to use is_system_admin().
--   2. Ran a dynamic DO block that regex-rewrites every existing RLS
--      policy referencing the UUID at the time it ran.
--
-- Six migrations added AFTER that cleanup still contain the UUID literal:
--   20260503000001_weather_tw_system_widget.sql
--   20260503000003_weather_global_system_widget.sql
--   20260503000007_announcement_widget_row.sql
--   20260504000003_queue_display_widget_row.sql
--   20260504000007_meeting_room_widget_row.sql
--   20260506000004_fix_issue_screen_device_token.sql
--
-- This migration is the equivalent cleanup for those — fixes the three
-- categories of usage:
--   (a) Storage policy `system_widgets_admin_all` (uses UUID literal in
--       USING/WITH CHECK) → replace with is_system_admin().
--   (b) Five `widgets` seed rows (use UUID literal in `created_by`) →
--       repoint to the actual root system_admin user_id.
--   (c) `public.issue_screen_device_token` RPC body (uses UUID literal in
--       permission check) → replace with is_system_admin().
--
-- Plus the same defensive DO-block rewrite as 20260420011350 to catch
-- anything else that might have slipped in (no-op if 20260420011350 left
-- a clean state).

-- ── (a) Storage policy ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "system_widgets_admin_all" ON storage.objects;
CREATE POLICY "system_widgets_admin_all"
  ON storage.objects FOR ALL TO authenticated
  USING       (bucket_id = 'system-widgets' AND public.is_system_admin(auth.uid()))
  WITH CHECK  (bucket_id = 'system-widgets' AND public.is_system_admin(auth.uid()));

COMMENT ON POLICY "system_widgets_admin_all" ON storage.objects IS
  'System admins manage system-widgets bucket objects. Was previously gated on a hardcoded UUID; now uses is_system_admin().';

-- ── (b) Widget seed rows — repoint created_by ──────────────────────────────
-- The 5 widgets seeded in 2026-05 migrations all have created_by set to
-- the hardcoded UUID. Repoint to the actual root system_admin so the
-- foreign-key intent still holds even if the original UUID account is
-- rotated/removed.
DO $$
DECLARE
  v_root_admin uuid;
BEGIN
  SELECT user_id INTO v_root_admin
    FROM public.system_admins
   WHERE is_root = true
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_root_admin IS NULL THEN
    RAISE NOTICE 'No root system_admin found — widget created_by rows untouched. Add a row to system_admins (is_root=true) and re-run UPDATE manually.';
    RETURN;
  END IF;

  UPDATE public.widgets
     SET created_by = v_root_admin
   WHERE created_by = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid;

  RAISE NOTICE 'Updated widgets.created_by → %', v_root_admin;
END
$$;

-- ── (c) issue_screen_device_token RPC ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_screen_device_token(_screen_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_screen RECORD;
  v_token  text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT id, org_id, name INTO v_screen FROM public.screens WHERE id = _screen_id;
  IF v_screen.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'screen_not_found');
  END IF;

  -- Permission: system admin (cross-org) or any org_admin / admin for this screen's org.
  IF NOT (
    public.is_system_admin(v_caller)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_caller AND org_id = v_screen.org_id AND role IN ('org_admin','admin')
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'permission_denied');
  END IF;

  -- extensions schema ensures pgcrypto is resolved correctly in Supabase
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.screens
  SET device_token           = v_token,
      device_token_issued_at = now(),
      device_token_issued_by = v_caller,
      updated_at             = now()
  WHERE id = _screen_id;

  RETURN jsonb_build_object('ok', true, 'screen_id', _screen_id, 'token', v_token, 'issued_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_screen_device_token(uuid) TO authenticated;

-- ── (d) Defensive sweep — same DO block as 20260420011350 ──────────────────
-- Idempotent: if 20260420011350 already cleaned everything, this just
-- iterates 0 rows. Catches anything that has crept back since.
DO $$
DECLARE
  r record;
  new_using text;
  new_check text;
  sql text;
  uuid_pattern     text := '\(?auth\.uid\(\)\s*=\s*''3fbb2f97-7268-4cac-a511-7cff6654a8f7''(::uuid)?\)?';
  uuid_pattern_rev text := '\(?''3fbb2f97-7268-4cac-a511-7cff6654a8f7''(::uuid)?\s*=\s*auth\.uid\(\)\)?';
  literal_pattern  text := '''3fbb2f97-7268-4cac-a511-7cff6654a8f7''(::uuid)?';
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           p.polname,
           pg_get_expr(p.polqual,      p.polrelid) AS using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
      FROM pg_policy p
      JOIN pg_class c    ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE COALESCE(pg_get_expr(p.polqual,      p.polrelid), '') LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%'
        OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%'
  LOOP
    new_using := r.using_expr;
    new_check := r.check_expr;

    IF new_using IS NOT NULL THEN
      new_using := regexp_replace(new_using, uuid_pattern,     'public.is_system_admin(auth.uid())', 'g');
      new_using := regexp_replace(new_using, uuid_pattern_rev, 'public.is_system_admin(auth.uid())', 'g');
      IF new_using LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%' THEN
        new_using := regexp_replace(new_using, literal_pattern,
          '(SELECT user_id FROM public.system_admins WHERE is_root = true LIMIT 1)', 'g');
      END IF;
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, uuid_pattern,     'public.is_system_admin(auth.uid())', 'g');
      new_check := regexp_replace(new_check, uuid_pattern_rev, 'public.is_system_admin(auth.uid())', 'g');
      IF new_check LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%' THEN
        new_check := regexp_replace(new_check, literal_pattern,
          '(SELECT user_id FROM public.system_admins WHERE is_root = true LIMIT 1)', 'g');
      END IF;
    END IF;

    sql := format('ALTER POLICY %I ON %I.%I', r.polname, r.schema_name, r.table_name);
    IF new_using IS NOT NULL THEN sql := sql || format(' USING (%s)',      new_using); END IF;
    IF new_check IS NOT NULL THEN sql := sql || format(' WITH CHECK (%s)', new_check); END IF;

    RAISE NOTICE 'Rewriting policy: %', sql;
    EXECUTE sql;
  END LOOP;
END
$$;

-- ── Sanity check — final count of remaining UUID references in policies ───
DO $$
DECLARE
  v_policy_count int;
BEGIN
  SELECT count(*) INTO v_policy_count
    FROM pg_policy p
   WHERE COALESCE(pg_get_expr(p.polqual,      p.polrelid), '') LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%'
      OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%';

  IF v_policy_count = 0 THEN
    RAISE NOTICE '[uuid-cleanup] All RLS policies clean of hardcoded UUID.';
  ELSE
    RAISE WARNING '[uuid-cleanup] % policy(ies) still reference hardcoded UUID after sweep — investigate.', v_policy_count;
  END IF;
END
$$;
