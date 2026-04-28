-- Create system_admins table
CREATE TABLE public.system_admins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  is_root boolean NOT NULL DEFAULT false,
  added_by uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_admins ENABLE ROW LEVEL SECURITY;

-- Security definer helper to check membership without recursive RLS
CREATE OR REPLACE FUNCTION public.is_system_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = _user_id)
$$;

-- RLS: only system admins can view
CREATE POLICY "System admins can view system_admins"
ON public.system_admins FOR SELECT TO authenticated
USING (public.is_system_admin(auth.uid()));

-- Inserts/deletes are done exclusively through SECURITY DEFINER RPCs below
-- (no INSERT/UPDATE/DELETE policies = locked down to RPC paths)

-- Seed the original hardcoded admin as root
INSERT INTO public.system_admins (user_id, is_root, note)
VALUES ('3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid, true, 'Original hardcoded system administrator (root)')
ON CONFLICT (user_id) DO NOTHING;

-- RPC: add a system admin (only existing system admins can call)
CREATE OR REPLACE FUNCTION public.add_system_admin(_user_id uuid, _note text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_exists boolean;
  v_target_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT public.is_system_admin(v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_user');
  END IF;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  INSERT INTO public.system_admins (user_id, added_by, note)
  VALUES (_user_id, v_caller, COALESCE(_note, ''))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT display_name INTO v_target_name FROM public.profiles WHERE user_id = _user_id;
  v_target_name := COALESCE(v_target_name, substr(_user_id::text, 1, 8));

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail)
  VALUES (
    v_caller, 'add_system_admin', 'security', 'user',
    _user_id::text, v_target_name,
    format('Granted system admin to %s', v_target_name)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC: remove a system admin (cannot remove root, cannot remove self)
CREATE OR REPLACE FUNCTION public.remove_system_admin(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row public.system_admins%ROWTYPE;
  v_target_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT public.is_system_admin(v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF _user_id = v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_remove_self');
  END IF;

  SELECT * INTO v_row FROM public.system_admins WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_row.is_root THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_remove_root');
  END IF;

  DELETE FROM public.system_admins WHERE user_id = _user_id;

  SELECT display_name INTO v_target_name FROM public.profiles WHERE user_id = _user_id;
  v_target_name := COALESCE(v_target_name, substr(_user_id::text, 1, 8));

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail)
  VALUES (
    v_caller, 'remove_system_admin', 'security', 'user',
    _user_id::text, v_target_name,
    format('Revoked system admin from %s', v_target_name)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC: list system admins with profile info (for the management UI)
CREATE OR REPLACE FUNCTION public.list_system_admins()
RETURNS TABLE (
  user_id uuid,
  is_root boolean,
  note text,
  added_by uuid,
  created_at timestamptz,
  display_name text,
  avatar_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sa.user_id, sa.is_root, sa.note, sa.added_by, sa.created_at,
         p.display_name, p.avatar_url
  FROM public.system_admins sa
  LEFT JOIN public.profiles p ON p.user_id = sa.user_id
  WHERE public.is_system_admin(auth.uid())
  ORDER BY sa.is_root DESC, sa.created_at ASC
$$;