-- Phase A: foundational schema for SIGNCMS 組織權限規則 rebuild
--
-- Per the rules document (SIGNCMS組織權限規則.rtf):
--   - service@bizlution.com and service@signcms.net are both 原生系統管理員 (immune to deletion)
--   - 代理商 (agent) is a new role: view-only across multiple assigned orgs
--   - 邀請 must include both a 64-char token link AND a 6-digit short_code in the email
--
-- This migration adds the foundational schema. RLS rewrites for the new agent role and
-- role-aligned permissions across all org-scoped tables come in Phase B.

-- ── 1. Both service accounts as is_root ────────────────────────────────────────
UPDATE public.system_admins
SET is_root = true
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE email IN ('service@bizlution.com', 'service@signcms.net')
);

-- ── 2. agent_org_assignments — multi-org membership for the new agent role ─────
CREATE TABLE IF NOT EXISTS public.agent_org_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_org_assignments_agent ON public.agent_org_assignments(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_org_assignments_org ON public.agent_org_assignments(org_id);

ALTER TABLE public.agent_org_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System admin can view all agent assignments" ON public.agent_org_assignments
  FOR SELECT TO authenticated USING (public.is_system_admin(auth.uid()));

CREATE POLICY "Agents can view their own assignments" ON public.agent_org_assignments
  FOR SELECT TO authenticated USING (auth.uid() = agent_user_id);

CREATE POLICY "System admin can insert agent assignments" ON public.agent_org_assignments
  FOR INSERT TO authenticated WITH CHECK (public.is_system_admin(auth.uid()));

CREATE POLICY "System admin can delete agent assignments" ON public.agent_org_assignments
  FOR DELETE TO authenticated USING (public.is_system_admin(auth.uid()));

-- ── 3. invitations.short_code — 6-digit human-friendly code ────────────────────
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS short_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_short_code_pending
  ON public.invitations(short_code)
  WHERE status = 'pending' AND short_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_invitation_short_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_attempts int := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    v_code := (100000 + floor(random() * 900000))::text;

    IF NOT EXISTS (
      SELECT 1 FROM public.invitations
      WHERE short_code = v_code AND status = 'pending'
    ) THEN
      RETURN v_code;
    END IF;

    IF v_attempts > 50 THEN
      RAISE EXCEPTION 'Could not generate unique short_code after 50 attempts';
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_invitation_short_code() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_invitation_short_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.short_code IS NULL THEN
    NEW.short_code := public.generate_invitation_short_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_invitation_short_code ON public.invitations;
CREATE TRIGGER trg_set_invitation_short_code
  BEFORE INSERT ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invitation_short_code();

UPDATE public.invitations
SET short_code = public.generate_invitation_short_code()
WHERE short_code IS NULL AND status = 'pending';

-- ── 4. Helper functions ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_agent(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'agent'::app_role
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_agent(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.agent_can_view_org(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_org_assignments
    WHERE agent_user_id = _user_id AND org_id = _org_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.agent_can_view_org(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_root_system_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.system_admins
    WHERE user_id = _user_id AND is_root = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_root_system_admin(uuid) TO authenticated;

-- ── 5. RPC: validate short_code (used by signup page) ──────────────────────────
-- Anon callable so non-authenticated users entering "Email + 6-digit code" on the
-- signup page can verify their invitation. Returns the matching token if valid,
-- so the client can route through the existing token-based signup flow.
CREATE OR REPLACE FUNCTION public.validate_invitation_short_code(p_email text, p_short_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv RECORD;
BEGIN
  IF p_email IS NULL OR p_short_code IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'missing_params');
  END IF;

  SELECT id, token, org_id, expires_at, status
    INTO v_inv
    FROM public.invitations
   WHERE lower(email) = lower(p_email)
     AND short_code = p_short_code
     AND status = 'pending'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'not_found');
  END IF;

  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'token', v_inv.token,
    'org_id', v_inv.org_id,
    'invitation_id', v_inv.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_invitation_short_code(text, text) TO anon, authenticated;
