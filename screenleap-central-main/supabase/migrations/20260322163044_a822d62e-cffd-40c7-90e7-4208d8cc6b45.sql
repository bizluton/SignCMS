
ALTER TABLE public.screens
  ADD COLUMN serial_number text NOT NULL DEFAULT '',
  ADD COLUMN ip_address text NOT NULL DEFAULT '',
  ADD COLUMN connection_type text NOT NULL DEFAULT 'wired',
  ADD COLUMN avg_upload_speed text NOT NULL DEFAULT '',
  ADD COLUMN avg_download_speed text NOT NULL DEFAULT '';
