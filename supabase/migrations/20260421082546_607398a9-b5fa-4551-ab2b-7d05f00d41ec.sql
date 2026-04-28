CREATE TABLE IF NOT EXISTS public.design_project_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_project_id uuid NOT NULL UNIQUE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dpdr_project ON public.design_project_delete_requests(design_project_id);
CREATE INDEX IF NOT EXISTS idx_dpdr_status ON public.design_project_delete_requests(status);
CREATE INDEX IF NOT EXISTS idx_dpdr_org ON public.design_project_delete_requests(org_id);

ALTER TABLE public.design_project_delete_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpdr_select_org"
  ON public.design_project_delete_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id))
  );

CREATE POLICY "dpdr_insert_org_admin_or_owner"
  ON public.design_project_delete_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.is_system_admin(auth.uid())
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.design_projects p
        WHERE p.id = design_project_id AND p.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "dpdr_update_owner_or_admin"
  ON public.design_project_delete_requests
  FOR UPDATE
  TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid()))
    OR requested_by = auth.uid()
  )
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid()))
    OR requested_by = auth.uid()
  );

CREATE POLICY "dpdr_delete_admin"
  ON public.design_project_delete_requests
  FOR DELETE
  TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND public.user_in_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid()))
  );

CREATE TRIGGER dpdr_update_updated_at
BEFORE UPDATE ON public.design_project_delete_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.count_design_project_references(_project_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT count(*) FROM public.media_items WHERE design_project_id = _project_id)
  + (SELECT count(*) FROM public.channels WHERE default_design_project_id = _project_id)
  + (SELECT count(*) FROM public.channel_allowed_projects WHERE design_project_id = _project_id)
  + (SELECT count(*) FROM public.channel_blocks WHERE design_project_id = _project_id)
$$;

CREATE OR REPLACE FUNCTION public.try_execute_pending_project_deletes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _candidate_ids uuid[];
  _pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'channels' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.default_design_project_id IS NOT NULL THEN
        _candidate_ids := ARRAY[OLD.default_design_project_id];
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.default_design_project_id IS DISTINCT FROM NEW.default_design_project_id
         AND OLD.default_design_project_id IS NOT NULL THEN
        _candidate_ids := ARRAY[OLD.default_design_project_id];
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'media_items' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.design_project_id IS NOT NULL THEN
        _candidate_ids := ARRAY[OLD.design_project_id];
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.design_project_id IS DISTINCT FROM NEW.design_project_id
         AND OLD.design_project_id IS NOT NULL THEN
        _candidate_ids := ARRAY[OLD.design_project_id];
      END IF;
    END IF;
  ELSE
    -- channel_allowed_projects, channel_blocks
    IF TG_OP = 'DELETE' THEN
      IF OLD.design_project_id IS NOT NULL THEN
        _candidate_ids := ARRAY[OLD.design_project_id];
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.design_project_id IS DISTINCT FROM NEW.design_project_id
         AND OLD.design_project_id IS NOT NULL THEN
        _candidate_ids := ARRAY[OLD.design_project_id];
      END IF;
    END IF;
  END IF;

  IF _candidate_ids IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOREACH _pid IN ARRAY _candidate_ids LOOP
    IF EXISTS (SELECT 1 FROM public.design_project_delete_requests
               WHERE design_project_id = _pid AND status = 'pending')
       AND public.count_design_project_references(_pid) = 0 THEN
      DELETE FROM public.design_projects WHERE id = _pid;
      UPDATE public.design_project_delete_requests
        SET status = 'executed', executed_at = now(), updated_at = now()
        WHERE design_project_id = _pid AND status = 'pending';
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_dpdr_media_items ON public.media_items;
CREATE TRIGGER trg_dpdr_media_items
AFTER DELETE OR UPDATE ON public.media_items
FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_project_deletes();

DROP TRIGGER IF EXISTS trg_dpdr_channels ON public.channels;
CREATE TRIGGER trg_dpdr_channels
AFTER DELETE OR UPDATE ON public.channels
FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_project_deletes();

DROP TRIGGER IF EXISTS trg_dpdr_channel_allowed_projects ON public.channel_allowed_projects;
CREATE TRIGGER trg_dpdr_channel_allowed_projects
AFTER DELETE OR UPDATE ON public.channel_allowed_projects
FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_project_deletes();

DROP TRIGGER IF EXISTS trg_dpdr_channel_blocks ON public.channel_blocks;
CREATE TRIGGER trg_dpdr_channel_blocks
AFTER DELETE OR UPDATE ON public.channel_blocks
FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_project_deletes();

CREATE OR REPLACE FUNCTION public.try_execute_project_delete_request(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _req public.design_project_delete_requests%ROWTYPE;
  _refs integer;
BEGIN
  SELECT * INTO _req FROM public.design_project_delete_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF _req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_pending', 'status', _req.status);
  END IF;
  _refs := public.count_design_project_references(_req.design_project_id);
  IF _refs > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'still_referenced', 'remaining', _refs);
  END IF;
  DELETE FROM public.design_projects WHERE id = _req.design_project_id;
  UPDATE public.design_project_delete_requests
    SET status = 'executed', executed_at = now(), updated_at = now()
    WHERE id = _request_id;
  RETURN jsonb_build_object('success', true);
END;
$$;