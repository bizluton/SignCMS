-- Bulk-update RPC for the MQTT-based heartbeat path.
--
-- Architecture:
--   Player publishes signage/player/{screenId}/heartbeat (QoS 0, retained)
--   every 60 seconds. A subscriber service (sidecar on the broker VM,
--   see mosquitto/heartbeat-collector/) batches incoming messages for
--   ~30 seconds and calls this RPC once per batch with a JSONB array.
--
-- Why this exists:
--   At 10k devices with a 60s heartbeat, the naive "one HTTP call per
--   device per minute" pattern would consume ~432M Supabase Edge Function
--   invocations per month — far over the Team tier (8M/month). Sending
--   all heartbeats through MQTT (free, low-cost broker push) and folding
--   them into a single bulk UPDATE collapses the cost into 2 RPC calls
--   per minute → ~86k calls/month.
--
-- Input shape (`p_heartbeats`):
--   [
--     { "screen_id": "<uuid>", "ts": "2026-05-21T12:34:56Z" },
--     { "screen_id": "<uuid>", "ts": "...", "disk_status": { ... } },
--     ...
--   ]
--
-- The RPC is SECURITY DEFINER and granted only to service_role so only
-- the trusted sidecar (or other backend processes) can call it.

CREATE OR REPLACE FUNCTION public.update_screen_heartbeats(
  p_heartbeats jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_heartbeats IS NULL OR jsonb_array_length(p_heartbeats) = 0 THEN
    RETURN 0;
  END IF;

  -- One UPDATE per call. Each row in the JSONB array is matched against
  -- screens.id; rows that don't match (screen deleted while heartbeat
  -- was in flight) are silently ignored.
  WITH input AS (
    SELECT
      (elem->>'screen_id')::uuid                    AS screen_id,
      COALESCE((elem->>'ts')::timestamptz, now())   AS ts,
      elem->'disk_status'                           AS disk_status
    FROM jsonb_array_elements(p_heartbeats) AS elem
    WHERE elem ? 'screen_id'
  )
  UPDATE public.screens s
     SET last_ping_at  = input.ts,
         online        = true,
         status        = 'online',
         updated_at    = input.ts,
         disk_status   = COALESCE(input.disk_status, s.disk_status),
         disk_status_at = CASE
           WHEN input.disk_status IS NOT NULL THEN input.ts
           ELSE s.disk_status_at
         END
    FROM input
   WHERE s.id = input.screen_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_screen_heartbeats(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_screen_heartbeats(jsonb) TO service_role;

COMMENT ON FUNCTION public.update_screen_heartbeats(jsonb) IS
  'Bulk-update screens.last_ping_at from a JSONB array of {screen_id, ts, disk_status?}. Called by the MQTT heartbeat-collector sidecar; service_role only.';

-- ── Mark stale screens as offline ──────────────────────────────────────────
-- The heartbeat path only ever sets online=true. We need a counterpart to
-- flip stale rows to offline. Runs on a pg_cron every minute.

CREATE OR REPLACE FUNCTION public.mark_stale_screens_offline(
  p_stale_after_seconds int DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.screens
     SET online     = false,
         status     = 'offline',
         updated_at = now()
   WHERE online = true
     AND (last_ping_at IS NULL
          OR last_ping_at < now() - make_interval(secs => p_stale_after_seconds));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_stale_screens_offline(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_stale_screens_offline(int) TO service_role;

-- ── Schedule: every minute mark anyone who hasn't heartbeat'd in 3 min offline
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('mark-stale-screens-offline');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'mark-stale-screens-offline',
      '* * * * *',  -- every minute
      $sql$SELECT public.mark_stale_screens_offline(180)$sql$
    );
    RAISE NOTICE 'mark-stale-screens-offline scheduled (every minute, 3min threshold).';
  END IF;
END
$$;
