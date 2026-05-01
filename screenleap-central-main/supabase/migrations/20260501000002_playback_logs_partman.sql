-- playback_logs: Convert to monthly-partitioned table via pg_partman
--
-- Problem: At 10K screens × 2,880 plays/day the table grows ~333 rows/sec.
--   Over 90 days that is 2.6 billion rows / ~52 GB. Daily DELETE-based cleanup
--   causes autovacuum pressure and can briefly block writes.
--
-- Solution: pg_partman monthly native partitioning.
--   Dropping an old monthly partition is instant (DROP TABLE internally),
--   zero autovacuum cost, and the table stays small automatically.
--
-- Retention: 3 months (configurable in partman.part_config).
--   partman.run_maintenance() runs daily at 04:00 UTC to:
--     - Create future partitions (premake=3 months ahead)
--     - Drop partitions older than 3 months
--
-- PK change: PostgreSQL requires the partition key to be part of any
--   PRIMARY KEY / UNIQUE constraint. PK becomes (id, played_at).
--   No existing queries select by id alone, so this is safe.
--
-- playback_logs is purely an analytics/audit sink (no FK references to it),
--   making it the ideal candidate for native range partitioning.

-- ─── 1. Enable pg_partman ────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

-- ─── 2. Rename old table (fast – just a catalog update) ──────────────────────
ALTER TABLE public.playback_logs RENAME TO playback_logs_legacy;

-- ─── 3. New partitioned parent ───────────────────────────────────────────────
CREATE TABLE public.playback_logs (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  screen_id        uuid,
  media_id         uuid,
  media_name       text        NOT NULL DEFAULT '',
  duration_seconds integer     NOT NULL DEFAULT 0,
  org_id           uuid,
  played_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, played_at)
) PARTITION BY RANGE (played_at);

-- ─── 4. Register with pg_partman ─────────────────────────────────────────────
-- Creates current-month partition + 3 future partitions immediately.
SELECT partman.create_parent(
  p_parent_table => 'public.playback_logs',
  p_control      => 'played_at',
  p_interval     => '1 month',
  p_premake      => 3
);

-- ─── 5. Retention policy ─────────────────────────────────────────────────────
-- Partitions older than 3 months are dropped (not just truncated) on each
-- run_maintenance() call. Set infinite_time_partitions so far-future inserts
-- (e.g. data backfills) auto-create partitions rather than erroring.
UPDATE partman.part_config
SET
  retention                = '3 months',
  retention_keep_table     = false,
  retention_keep_index     = false,
  infinite_time_partitions = true
WHERE parent_table = 'public.playback_logs';

-- ─── 6. Recreate indexes ─────────────────────────────────────────────────────
-- Indexes on the parent table are propagated to all existing and future
-- child partitions by pg_partman automatically.
CREATE INDEX IF NOT EXISTS idx_playback_logs_media
  ON public.playback_logs (media_id);
CREATE INDEX IF NOT EXISTS idx_playback_logs_screen
  ON public.playback_logs (screen_id);
CREATE INDEX IF NOT EXISTS idx_playback_logs_org_played
  ON public.playback_logs (org_id, played_at DESC);

-- ─── 7. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.playback_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can insert playback logs"
  ON public.playback_logs FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id))
  );

CREATE POLICY "Users can view playback logs in their org or admins see all"
  ON public.playback_logs FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NULL)
    OR user_in_org(auth.uid(), org_id)
  );

-- ─── 8. Migrate legacy data then drop backup ─────────────────────────────────
-- 0 rows in dev; in production runs inside a transaction so it's atomic.
-- For very large tables (>100M rows) consider a batched migration instead.
INSERT INTO public.playback_logs
  SELECT id, screen_id, media_id, media_name, duration_seconds, org_id, played_at
  FROM public.playback_logs_legacy;

DROP TABLE public.playback_logs_legacy;

-- ─── 9. Update pg_cron jobs ──────────────────────────────────────────────────
-- a) Remove purge_old_playback_logs from the daily DELETE job (partman owns it now).
DO $$
BEGIN
  PERFORM cron.unschedule('purge-log-tables-daily');
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-log-tables-daily',
  '30 3 * * *',
  $cron$
    SELECT public.purge_old_iot_sensor_readings(90);
    SELECT public.purge_old_screen_logs(90);
    SELECT public.purge_old_smart_trigger_logs(30);
  $cron$
);

-- b) Daily partman maintenance at 04:00 UTC.
--    Creates partitions 3 months ahead; drops partitions older than 3 months.
--    p_analyze=false avoids ANALYZE on potentially large partitions mid-cleanup.
DO $$
BEGIN
  PERFORM cron.unschedule('partman-maintenance-daily');
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'partman-maintenance-daily',
  '0 4 * * *',
  $cron$
    SELECT partman.run_maintenance(p_analyze := false);
  $cron$
);
