-- 1. Delegation grants table
CREATE TABLE public.delegation_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_id uuid NOT NULL,
  grantee_id uuid NOT NULL,
  grantee_scope text NOT NULL CHECK (grantee_scope IN ('org_admin','cs_agent')),
  reason text DEFAULT '',
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  revoked_by uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (grantor_id <> grantee_id)
);

CREATE INDEX idx_delegation_grants_grantor ON public.delegation_grants(grantor_id, status);
CREATE INDEX idx_delegation_grants_grantee ON public.delegation_grants(grantee_id, status);
CREATE INDEX idx_delegation_grants_expires ON public.delegation_grants(expires_at) WHERE status = 'active';

-- 2. Updated_at trigger
CREATE TRIGGER update_delegation_grants_updated_at
BEFORE UPDATE ON public.delegation_grants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Enable RLS
ALTER TABLE public.delegation_grants ENABLE ROW LEVEL SECURITY;

-- 4. Validation: grantee must be either org_admin in same org, or active CS agent
CREATE OR REPLACE FUNCTION public.validate_delegation_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.expires_at <= now() THEN
    RAISE EXCEPTION 'Expiry time must be in the future';
  END IF;

  IF NEW.grantee_scope = 'cs_agent' THEN
    IF NOT public.is_active_cs_agent(NEW.grantee_id) THEN
      RAISE EXCEPTION 'Grantee is not an active CS agent';
    END IF;
  ELSIF NEW.grantee_scope = 'org_admin' THEN
    IF NOT public.is_org_admin(NEW.grantee_id) THEN
      RAISE EXCEPTION 'Grantee is not an org_admin';
    END IF;
    -- Must share at least one org with the grantor
    IF NOT EXISTS (
      SELECT 1
      FROM public.team_members tm1
      JOIN public.teams t1 ON t1.id = tm1.team_id
      JOIN public.teams t2 ON t2.org_id = t1.org_id
      JOIN public.team_members tm2 ON tm2.team_id = t2.id
      WHERE tm1.user_id = NEW.grantor_id AND tm2.user_id = NEW.grantee_id
    ) THEN
      RAISE EXCEPTION 'Grantee org_admin is not in the same organization as grantor';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_delegation_grant_trigger
BEFORE INSERT ON public.delegation_grants
FOR EACH ROW
EXECUTE FUNCTION public.validate_delegation_grant();

-- 5. RLS policies
-- Grantor can insert own grants
CREATE POLICY "Grantor can create own grants"
ON public.delegation_grants
FOR INSERT
TO authenticated
WITH CHECK (grantor_id = auth.uid());

-- Grantor and grantee can view related grants
CREATE POLICY "Grantor can view own grants"
ON public.delegation_grants
FOR SELECT
TO authenticated
USING (grantor_id = auth.uid());

CREATE POLICY "Grantee can view received grants"
ON public.delegation_grants
FOR SELECT
TO authenticated
USING (grantee_id = auth.uid());

-- Both grantor and grantee can revoke / mark expired
CREATE POLICY "Grantor or grantee can update status"
ON public.delegation_grants
FOR UPDATE
TO authenticated
USING (grantor_id = auth.uid() OR grantee_id = auth.uid())
WITH CHECK (grantor_id = auth.uid() OR grantee_id = auth.uid());