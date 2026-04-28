-- Device licenses table
CREATE TABLE public.device_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_model text NOT NULL,
  device_serial text NOT NULL,
  code text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  note text DEFAULT '',
  created_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_licenses_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT device_licenses_code_chk CHECK (code ~ '^[0-9]{6}$'),
  CONSTRAINT device_licenses_model_serial_uniq UNIQUE (device_model, device_serial)
);

CREATE INDEX idx_device_licenses_org ON public.device_licenses(org_id);
CREATE INDEX idx_device_licenses_code ON public.device_licenses(code);

ALTER TABLE public.device_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/CS can view device licenses"
ON public.device_licenses FOR SELECT TO authenticated
USING (public.is_system_admin(auth.uid()) OR public.is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin/CS can insert device licenses"
ON public.device_licenses FOR INSERT TO authenticated
WITH CHECK (public.is_system_admin(auth.uid()) OR public.is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin/CS can update device licenses"
ON public.device_licenses FOR UPDATE TO authenticated
USING (public.is_system_admin(auth.uid()) OR public.is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin/CS can delete device licenses"
ON public.device_licenses FOR DELETE TO authenticated
USING (public.is_system_admin(auth.uid()) OR public.is_active_cs_agent(auth.uid()));

CREATE TRIGGER device_licenses_updated_at
BEFORE UPDATE ON public.device_licenses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Generate
CREATE OR REPLACE FUNCTION public.generate_device_license(
  _device_model text,
  _device_serial text,
  _org_id uuid,
  _note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_model text := trim(COALESCE(_device_model, ''));
  v_serial text := trim(COALESCE(_device_serial, ''));
  v_code text;
  v_id uuid;
  v_org_name text;
  v_attempts int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF v_model = '' OR length(v_model) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_device_model');
  END IF;
  IF v_serial = '' OR length(v_serial) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_device_serial');
  END IF;
  IF _org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_required');
  END IF;
  SELECT name INTO v_org_name FROM public.organizations WHERE id = _org_id;
  IF v_org_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.device_licenses WHERE device_model = v_model AND device_serial = v_serial) THEN
    RETURN jsonb_build_object('success', false, 'error', 'device_already_registered');
  END IF;

  -- Generate unique 6-digit code (uniqueness on (model,serial) is what matters; codes can repeat globally)
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO public.device_licenses (device_model, device_serial, code, org_id, note, created_by)
  VALUES (v_model, v_serial, v_code, _org_id, COALESCE(_note, ''), v_caller)
  RETURNING id INTO v_id;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'generate_device_license', 'license', 'device_license',
    v_id::text, v_model || '/' || v_serial,
    format('Generated device license for %s/%s -> org=%s code=%s', v_model, v_serial, v_org_name, v_code),
    _org_id
  );

  RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code);
END;
$$;

-- Revoke
CREATE OR REPLACE FUNCTION public.revoke_device_license(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row public.device_licenses%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  SELECT * INTO v_row FROM public.device_licenses WHERE id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  UPDATE public.device_licenses
     SET status = 'revoked', revoked_at = now(), revoked_by = v_caller
   WHERE id = _id;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'revoke_device_license', 'license', 'device_license',
    _id::text, v_row.device_model || '/' || v_row.device_serial,
    format('Revoked device license %s/%s', v_row.device_model, v_row.device_serial),
    v_row.org_id
  );
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Restore
CREATE OR REPLACE FUNCTION public.restore_device_license(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row public.device_licenses%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  SELECT * INTO v_row FROM public.device_licenses WHERE id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  UPDATE public.device_licenses
     SET status = 'active', revoked_at = NULL, revoked_by = NULL
   WHERE id = _id;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'restore_device_license', 'license', 'device_license',
    _id::text, v_row.device_model || '/' || v_row.device_serial,
    format('Restored device license %s/%s', v_row.device_model, v_row.device_serial),
    v_row.org_id
  );
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Delete
CREATE OR REPLACE FUNCTION public.delete_device_license(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row public.device_licenses%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthenticated'); END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  SELECT * INTO v_row FROM public.device_licenses WHERE id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  DELETE FROM public.device_licenses WHERE id = _id;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'delete_device_license', 'license', 'device_license',
    _id::text, v_row.device_model || '/' || v_row.device_serial,
    format('Deleted device license %s/%s', v_row.device_model, v_row.device_serial),
    v_row.org_id
  );
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Verify (public; called by edge function with service role bypass anyway, but safe to be SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.verify_device_license(
  _device_model text, _device_serial text, _code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.device_licenses%ROWTYPE;
  v_org_name text;
BEGIN
  IF _device_model IS NULL OR _device_serial IS NULL OR _code IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_arguments');
  END IF;
  IF _code !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_code_format');
  END IF;

  SELECT * INTO v_row FROM public.device_licenses
   WHERE device_model = trim(_device_model) AND device_serial = trim(_device_serial);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'not_found');
  END IF;
  IF v_row.code <> _code THEN
    RETURN jsonb_build_object('valid', false, 'error', 'code_mismatch');
  END IF;
  IF v_row.status <> 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'revoked');
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_row.org_id;

  RETURN jsonb_build_object(
    'valid', true,
    'org_id', v_row.org_id,
    'org_name', v_org_name,
    'device_model', v_row.device_model,
    'device_serial', v_row.device_serial,
    'status', v_row.status
  );
END;
$$;
