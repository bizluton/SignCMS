-- Harden the device-activation flow (activate-device edge function):
--   1. Atomic claim of screen_activation_codes — prevents two concurrent
--      devices from both claiming the same code (the old SELECT-then-UPDATE
--      pattern would let both succeed and create duplicate screens / both
--      receive a device_token).
--   2. Per-IP brute-force rate limit — the 6-digit code keyspace is only
--      10^6; without any throttle an attacker could enumerate codes.

-- ── 1. Atomic claim RPC ─────────────────────────────────────────────────────
-- UPDATE … WHERE status='pending' RETURNING is atomic at the row level: at
-- most one concurrent call gets a non-empty result. Subsequent racing calls
-- see zero rows and the caller must treat that as "code already used".
CREATE OR REPLACE FUNCTION public.claim_screen_activation_code(p_code text)
RETURNS TABLE (id uuid, org_id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.screen_activation_codes
     SET status = 'used', used_at = now()
   WHERE code   = p_code
     AND status = 'pending'
  RETURNING id, org_id, name;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_screen_activation_code(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_screen_activation_code(text) TO anon, authenticated;

COMMENT ON FUNCTION public.claim_screen_activation_code(text) IS
  'Atomically marks a screen_activation_codes row as used. Returns the claimed row, or 0 rows if the code was already used / does not exist. Avoids the SELECT-then-UPDATE race in activate-device.';

-- ── 2. Rate limit infrastructure ────────────────────────────────────────────
-- Anon-callable functions get one DB write per attempt; cheap.
-- IP is derived from the x-forwarded-for header on the edge function side.
CREATE TABLE IF NOT EXISTS public.device_activation_attempts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip           text        NOT NULL,
  code_hint    text        NOT NULL,                 -- first 2 chars only; enough for forensics, not enough to enumerate
  succeeded    boolean     NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_activation_attempts_ip_time_idx
  ON public.device_activation_attempts (ip, attempted_at DESC);

ALTER TABLE public.device_activation_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: rows are only ever inserted via the SECURITY DEFINER RPC below
-- and read by system admins through future tooling (no UI today).

-- Check whether the given IP is over its 5-minute failure budget.
-- Returns TRUE if the caller may proceed, FALSE if blocked.
CREATE OR REPLACE FUNCTION public.device_activation_rate_ok(p_ip text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fails int;
BEGIN
  IF p_ip IS NULL OR length(trim(p_ip)) = 0 THEN
    RETURN true;  -- can't rate-limit unknown IPs; rely on other mitigations
  END IF;
  SELECT count(*) INTO fails
    FROM public.device_activation_attempts
   WHERE ip            = p_ip
     AND succeeded     = false
     AND attempted_at  > now() - interval '5 minutes';
  RETURN fails < 10;  -- threshold: 10 failed attempts per 5 minutes per IP
END;
$$;

REVOKE EXECUTE ON FUNCTION public.device_activation_rate_ok(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.device_activation_rate_ok(text) TO anon, authenticated;

-- Log an attempt (success or failure). Always succeeds; never raises.
CREATE OR REPLACE FUNCTION public.log_device_activation_attempt(
  p_ip   text,
  p_code text,
  p_ok   boolean
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.device_activation_attempts (ip, code_hint, succeeded)
  VALUES (
    coalesce(p_ip, ''),
    coalesce(substring(p_code from 1 for 2), ''),  -- store only the first 2 chars
    coalesce(p_ok, false)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.log_device_activation_attempt(text, text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_device_activation_attempt(text, text, boolean) TO anon, authenticated;

-- ── 3. TTL cleanup — drop attempts older than 24h hourly ────────────────────
-- Keep the table small even under attack.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('device-activation-attempts-cleanup');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;  -- cron.unschedule throws if job doesn't exist
END
$do$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'device-activation-attempts-cleanup',
      '0 * * * *',
      $sql$DELETE FROM public.device_activation_attempts WHERE attempted_at < now() - interval '24 hours'$sql$
    );
  END IF;
END
$do$;
