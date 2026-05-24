-- #79 P3-NEW-1: Add ip_address column to device_registrations for rate limiting
--
-- The register-device edge function is fully anonymous. Without rate limiting,
-- an attacker can brute-force the 6-char join_code (~10^6 possibilities) by
-- submitting unlimited registration requests.
--
-- This migration adds ip_address so the edge function can enforce a per-IP
-- cap (20 new registrations per hour). Existing rows get NULL; new rows are
-- populated by the edge function.

ALTER TABLE public.device_registrations
  ADD COLUMN IF NOT EXISTS ip_address text;

-- Index used by the rate-limit check in the edge function
CREATE INDEX IF NOT EXISTS idx_device_reg_ip_created
  ON public.device_registrations (ip_address, created_at)
  WHERE ip_address IS NOT NULL;
