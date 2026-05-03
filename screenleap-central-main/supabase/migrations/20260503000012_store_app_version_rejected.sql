-- Add 'rejected' status to store_app_versions and a review_note column.
-- Allows admins to reject a specific version without affecting the parent app.

ALTER TABLE public.store_app_versions
  DROP CONSTRAINT IF EXISTS store_app_versions_status_check;

ALTER TABLE public.store_app_versions
  ADD CONSTRAINT store_app_versions_status_check
  CHECK (status IN ('draft', 'active', 'deprecated', 'rejected'));

ALTER TABLE public.store_app_versions
  ADD COLUMN IF NOT EXISTS review_note text;
