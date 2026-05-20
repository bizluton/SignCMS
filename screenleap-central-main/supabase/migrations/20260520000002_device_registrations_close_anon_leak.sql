-- Close the device_registrations anon-read leak.
--
-- Background:
--   The original `anon_read_own_registration USING (true)` policy let any
--   unauthenticated client SELECT * from device_registrations and harvest
--   approved devices' `device_token` (which approve-device wrote into the
--   row for legacy re-claim support).
--
-- Fix:
--   1. Drop the anon SELECT policy entirely. Devices learn their
--      registrationId from the HTTP response of register-device; status
--      changes arrive over the existing Realtime broadcast channel
--      (`device-reg:<registrationId>`) — no SQL SELECT is needed.
--   2. Provide a minimal SECURITY DEFINER RPC for the rare case where a
--      device must poll status without subscribing (returns ONLY the
--      status string, never the token).
--   3. The `device_token` column itself is left in place to avoid breaking
--      already-deployed player builds during rollout; approve-device
--      stops writing to it (handled in code change in the same commit).
--      A follow-up migration may drop the column once player apps are
--      updated.

DROP POLICY IF EXISTS "anon_read_own_registration" ON public.device_registrations;

-- Anon may still INSERT (register-device flow runs as anon).
-- The anon_insert_device_registration policy remains untouched.

-- RPC: minimal status check for legacy clients during transition.
-- Returns null if not found, otherwise just the status text.
-- Crucially, never returns device_token.
CREATE OR REPLACE FUNCTION public.device_registration_status(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status FROM public.device_registrations WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.device_registration_status(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.device_registration_status(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.device_registration_status(uuid) IS
  'Anon-callable status check for an in-flight device registration. Returns only the status text; device_token is delivered exclusively via the device-reg:<id> Realtime channel.';

COMMENT ON COLUMN public.device_registrations.device_token IS
  'DEPRECATED — no longer populated on new approvals. Tokens are delivered exclusively via the device-reg:<id> Realtime channel. Column kept temporarily for backward compatibility with already-deployed players; will be dropped in a follow-up migration.';
