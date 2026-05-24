-- Schema drift fix #2: activity_logs missing action_code, action_params,
-- detail_json — same pattern as profiles in migration 20260524000011.
-- The frontend logActivity helper writes these on every user action, so
-- POST /rest/v1/activity_logs was returning 400 BAD REQUEST on every flow
-- that calls logActivity (resending invitations, deleting users, role
-- changes, etc.).
--
-- Originally added in migrations 20260418040621 (action_code +
-- action_params) and 20260420070327 (detail_json) but not present in
-- the live DB.

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS action_code text,
  ADD COLUMN IF NOT EXISTS action_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS detail_json jsonb;

CREATE INDEX IF NOT EXISTS idx_activity_logs_action_code
  ON public.activity_logs (action_code);
