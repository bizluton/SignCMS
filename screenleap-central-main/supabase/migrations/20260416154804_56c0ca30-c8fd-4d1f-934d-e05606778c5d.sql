
-- Add license fields to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS license_plan text NOT NULL DEFAULT '試用30日',
  ADD COLUMN IF NOT EXISTS license_expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS license_reminder_sent jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Create license_codes table
CREATE TABLE public.license_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  extend_days integer NOT NULL DEFAULT 365,
  plan_name text NOT NULL DEFAULT '標準年度授權',
  created_by uuid NOT NULL,
  redeemed_by_org uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  redeemed_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.license_codes ENABLE ROW LEVEL SECURITY;

-- System admin (hardcoded UUID) can do everything with license_codes
CREATE POLICY "System admin can manage license_codes"
  ON public.license_codes FOR ALL
  TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7')
  WITH CHECK (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7');

-- Org admins can view redeemed codes for their org
CREATE POLICY "Org admins can view own org codes"
  ON public.license_codes FOR SELECT
  TO authenticated
  USING (
    is_org_admin(auth.uid())
    AND redeemed_by_org IS NOT NULL
    AND user_in_org(auth.uid(), redeemed_by_org)
  );

-- Org admins can update pending codes (to redeem them)
CREATE POLICY "Org admins can redeem pending codes"
  ON public.license_codes FOR UPDATE
  TO authenticated
  USING (status = 'pending')
  WITH CHECK (status = 'redeemed');

-- Function to redeem a license code for an org
CREATE OR REPLACE FUNCTION public.redeem_license_code(_code text, _org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _license license_codes%ROWTYPE;
  _new_expires timestamp with time zone;
BEGIN
  -- Find and lock the code
  SELECT * INTO _license FROM public.license_codes
  WHERE code = _code AND status = 'pending'
  FOR UPDATE;

  IF _license IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '授權碼無效或已被使用');
  END IF;

  -- Check caller is org_admin of the org
  IF NOT is_org_admin(auth.uid()) OR NOT user_in_org(auth.uid(), _org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '權限不足');
  END IF;

  -- Calculate new expiry: extend from current expiry or now, whichever is later
  SELECT GREATEST(license_expires_at, now()) + (_license.extend_days || ' days')::interval
  INTO _new_expires
  FROM public.organizations WHERE id = _org_id;

  -- Update org
  UPDATE public.organizations
  SET license_expires_at = _new_expires,
      license_plan = _license.plan_name,
      license_reminder_sent = '[]'::jsonb
  WHERE id = _org_id;

  -- Mark code as redeemed
  UPDATE public.license_codes
  SET status = 'redeemed',
      redeemed_by_org = _org_id,
      redeemed_at = now()
  WHERE id = _license.id;

  RETURN jsonb_build_object('success', true, 'new_expires_at', _new_expires, 'plan_name', _license.plan_name);
END;
$$;
