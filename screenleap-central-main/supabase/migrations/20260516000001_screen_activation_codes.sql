-- screen_activation_codes: admin creates a code with just a screen name
-- → device enters the 6-digit code in web-player → screen is created with real device info
--
-- Flow:
--   Admin: "新增 Web Player" → enters screen name → gets 6-digit code
--   Device: opens web-player.html → enters code → screen created with real serial/model
--   Code is consumed (status='used') and Realtime notifies the admin UI

CREATE TABLE IF NOT EXISTS screen_activation_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text        NOT NULL,          -- Screen name chosen by admin
  code       text        NOT NULL UNIQUE,   -- 6-digit activation code
  status     text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'used')),
  screen_id  uuid        REFERENCES screens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);

-- Index for the common query in activate-device: WHERE code=? AND status='pending'
CREATE INDEX IF NOT EXISTS screen_activation_codes_code_pending_idx
  ON screen_activation_codes(code)
  WHERE status = 'pending';

-- RLS: org members can manage their org's codes; system admins can manage all
ALTER TABLE screen_activation_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_manage_activation_codes"
  ON screen_activation_codes FOR ALL TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.user_in_org(auth.uid(), org_id)
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.user_in_org(auth.uid(), org_id)
  );

-- Add device_model to screens for real device info write-back from web players
ALTER TABLE screens ADD COLUMN IF NOT EXISTS device_model text;
