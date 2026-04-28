-- Add webhook_token column to organizations
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS webhook_token TEXT;

-- Generate tokens for existing rows (32 bytes hex = 64 chars)
UPDATE public.organizations
SET webhook_token = encode(gen_random_bytes(32), 'hex')
WHERE webhook_token IS NULL;

-- Make NOT NULL with default for future rows
ALTER TABLE public.organizations
ALTER COLUMN webhook_token SET NOT NULL,
ALTER COLUMN webhook_token SET DEFAULT encode(gen_random_bytes(32), 'hex');

-- Unique index for fast token-based lookup in webhook
CREATE UNIQUE INDEX IF NOT EXISTS organizations_webhook_token_idx
ON public.organizations(webhook_token);

-- Function: regenerate webhook token (admin/owner or system admin)
CREATE OR REPLACE FUNCTION public.regenerate_org_webhook_token(_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_token TEXT;
  _is_allowed BOOLEAN;
BEGIN
  -- Check: caller is system admin OR org admin/owner
  SELECT EXISTS (
    SELECT 1 FROM public.system_admins WHERE user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND org_id = _org_id
      AND role IN ('admin', 'owner')
  ) INTO _is_allowed;

  IF NOT _is_allowed THEN
    RAISE EXCEPTION 'Insufficient permissions to regenerate webhook token';
  END IF;

  _new_token := encode(gen_random_bytes(32), 'hex');

  UPDATE public.organizations
  SET webhook_token = _new_token,
      updated_at = now()
  WHERE id = _org_id;

  RETURN _new_token;
END;
$$;