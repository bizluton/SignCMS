-- Partition-management infrastructure for playback_logs.
--
-- The cutover from the current heap table to monthly partitions is NOT
-- performed here — that requires a maintenance window (block writes,
-- copy data, swap names, re-attach FKs/RLS). See:
--   docs/runbooks/playback-logs-partition-cutover.md
--
-- This migration only sets up the management functions + safety NOTICE
-- so the cutover script can use them. Idempotent on every replay.

-- ── Helper: ensure a partition exists for the given month ─────────────────
--
-- The cutover script (and the cron below) call this. After the cutover the
-- target table is partitioned, so partitions can attach. Before the cutover
-- the function is a no-op (table is plain heap; CREATE PARTITION OF would
-- fail). The exists-check uses pg_partitioned_table → safe pre-cutover too.
CREATE OR REPLACE FUNCTION public.ensure_playback_logs_partition(p_month_start date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partition_name text;
  v_range_end      date;
  v_is_partitioned boolean;
BEGIN
  -- Only run when the target table is actually partitioned.
  SELECT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'playback_logs'
  ) INTO v_is_partitioned;

  IF NOT v_is_partitioned THEN
    RETURN 'skipped: playback_logs is not yet partitioned';
  END IF;

  v_partition_name := format('playback_logs_y%sm%s',
                              to_char(p_month_start, 'YYYY'),
                              to_char(p_month_start, 'MM'));
  v_range_end      := p_month_start + interval '1 month';

  -- IF NOT EXISTS guards both the table check and the schema-qualified
  -- partition; the format() call is safe because all inputs are dates.
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I '
    'PARTITION OF public.playback_logs '
    'FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, p_month_start, v_range_end
  );

  RETURN v_partition_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_playback_logs_partition(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ensure_playback_logs_partition(date) TO service_role;

-- ── Helper: pre-create future partitions ─────────────────────────────────
-- Schedule this monthly so each new month has its partition ready before
-- the first INSERT lands.
CREATE OR REPLACE FUNCTION public.create_next_playback_logs_partitions(p_months_ahead int DEFAULT 2)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  i             int;
  v_target_date date;
  v_created     text[] := ARRAY[]::text[];
  v_result      text;
BEGIN
  -- Always ensure the current month exists.
  v_target_date := date_trunc('month', now())::date;
  v_result      := public.ensure_playback_logs_partition(v_target_date);
  v_created     := array_append(v_created, v_target_date::text || ' → ' || v_result);

  FOR i IN 1..p_months_ahead LOOP
    v_target_date := (date_trunc('month', now()) + (i || ' months')::interval)::date;
    v_result      := public.ensure_playback_logs_partition(v_target_date);
    v_created     := array_append(v_created, v_target_date::text || ' → ' || v_result);
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_next_playback_logs_partitions(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_next_playback_logs_partitions(int) TO service_role;

-- ── Helper: drop a single partition older than the cutoff ────────────────
-- Faster than DELETE for retention. Returns the partition name (or null).
CREATE OR REPLACE FUNCTION public.drop_oldest_playback_logs_partition(p_cutoff date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partition record;
BEGIN
  -- Find the oldest partition whose range upper bound is <= cutoff.
  SELECT child.relname, parts.bounds
    INTO v_partition
    FROM pg_inherits i
    JOIN pg_class    parent ON parent.oid = i.inhparent
    JOIN pg_class    child  ON child.oid  = i.inhrelid
    CROSS JOIN LATERAL pg_get_expr(child.relpartbound, child.oid) AS parts(bounds)
   WHERE parent.relname = 'playback_logs'
     AND child.relname LIKE 'playback_logs_y%m%'
     AND child.relname < format('playback_logs_y%sm%s',
                                  to_char(p_cutoff, 'YYYY'),
                                  to_char(p_cutoff, 'MM'))
   ORDER BY child.relname ASC
   LIMIT 1;

  IF v_partition.relname IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE format('DROP TABLE public.%I', v_partition.relname);
  RETURN v_partition.relname;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.drop_oldest_playback_logs_partition(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.drop_oldest_playback_logs_partition(date) TO service_role;

-- ── Cron: pre-create next 2 months of partitions (1st of each month) ──────
-- No-op until the cutover happens (functions internally check
-- pg_partitioned_table). Safe to schedule pre-cutover.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('playback-logs-partition-prep');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'playback-logs-partition-prep',
      '0 0 1 * *',  -- midnight on the 1st of each month
      $sql$SELECT public.create_next_playback_logs_partitions(2)$sql$
    );
    RAISE NOTICE 'playback-logs-partition-prep cron scheduled (no-op until cutover).';
  END IF;
END
$do$;

-- ── Cutover status notice ─────────────────────────────────────────────────
DO $$
DECLARE
  v_is_partitioned boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'playback_logs'
  ) INTO v_is_partitioned;

  IF v_is_partitioned THEN
    RAISE NOTICE '[playback_logs partitioning] table is already partitioned ✓';
  ELSE
    RAISE NOTICE '[playback_logs partitioning] infrastructure installed; table still heap. Cutover requires a maintenance window — see docs/runbooks/playback-logs-partition-cutover.md';
  END IF;
END
$$;
