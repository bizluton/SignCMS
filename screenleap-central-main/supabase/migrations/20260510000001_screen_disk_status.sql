-- Migration: add CAS disk-status telemetry columns to screens table
--
-- disk_status      JSONB — latest DiskStatus snapshot from the Android CAS engine:
--                    { casDirPath, casTotalBytes, casFileCount, freeBytesExternal,
--                      manifestTotal, manifestSynced, manifestPending, manifestFailed,
--                      failures: [{sha256, url, attempts, lastFailedMs, expectedHash,
--                                  actualHash, lastError}] }
-- disk_status_at   TIMESTAMPTZ — when the player last reported this snapshot
--
-- Both columns are updated by player-sync on every heartbeat that includes a
-- disk_status field in the POST body.  Null until a player has synced at least once.

ALTER TABLE public.screens
  ADD COLUMN IF NOT EXISTS disk_status    jsonb,
  ADD COLUMN IF NOT EXISTS disk_status_at timestamptz;

-- GIN index on disk_status enables fast JSONB queries like:
--   WHERE disk_status->>'manifestFailed' != '0'
CREATE INDEX IF NOT EXISTS idx_screens_disk_status
  ON public.screens USING gin (disk_status)
  WHERE disk_status IS NOT NULL;

COMMENT ON COLUMN public.screens.disk_status    IS 'CAS sync-engine telemetry from Android player (JSONB snapshot)';
COMMENT ON COLUMN public.screens.disk_status_at IS 'Timestamp of last disk_status report from this player';
