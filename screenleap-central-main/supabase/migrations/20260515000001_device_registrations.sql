-- Device self-registration support
-- Allows devices to open a join URL and auto-appear as pending in Device License Management

-- 1. Add join_token to organizations (used as the "join URL" key)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS join_token text;

-- Generate a unique join token for every existing org that doesn't have one
UPDATE organizations
SET join_token = encode(extensions.gen_random_bytes(16), 'hex')
WHERE join_token IS NULL;

-- 2. Pending device registrations table
CREATE TABLE IF NOT EXISTS device_registrations (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Device-reported info
  device_serial  text,
  device_model   text,
  user_agent     text        NOT NULL DEFAULT '',
  fingerprint    text        NOT NULL DEFAULT '',
  -- Set on approval
  screen_id      uuid        REFERENCES screens(id),
  device_token   text,
  -- Timestamps
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz,
  approved_by    uuid        REFERENCES auth.users(id)
);

-- RLS: org admins may read their own org's registrations
ALTER TABLE device_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_manage_device_registrations"
  ON device_registrations
  FOR ALL
  TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.user_in_org(auth.uid(), org_id)
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.user_in_org(auth.uid(), org_id)
  );

-- Allow anon INSERT only (devices register without auth)
CREATE POLICY "anon_insert_device_registration"
  ON device_registrations
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon SELECT on their own registration (to poll status by id)
CREATE POLICY "anon_read_own_registration"
  ON device_registrations
  FOR SELECT
  TO anon
  USING (true);
