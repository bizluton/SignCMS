-- Channel delete request queue (mirrors design_project_delete_requests)
CREATE TABLE public.channel_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  executed_at timestamptz,
  CONSTRAINT channel_delete_requests_unique_pending UNIQUE (channel_id)
);

ALTER TABLE public.channel_delete_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY cdr_select_org ON public.channel_delete_requests
  FOR SELECT TO authenticated
  USING (
    is_system_admin(auth.uid())
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
  );

CREATE POLICY cdr_insert_org_admin_or_owner ON public.channel_delete_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      is_system_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = channel_delete_requests.channel_id
          AND c.created_by = auth.uid()
      )
    )
  );

CREATE POLICY cdr_update_owner_or_admin ON public.channel_delete_requests
  FOR UPDATE TO authenticated
  USING (
    is_system_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
    OR requested_by = auth.uid()
  )
  WITH CHECK (
    is_system_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
    OR requested_by = auth.uid()
  );

CREATE POLICY cdr_delete_admin ON public.channel_delete_requests
  FOR DELETE TO authenticated
  USING (
    is_system_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- Count references that should block channel deletion
CREATE OR REPLACE FUNCTION public.count_channel_references(_channel_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.screen_channel_subscriptions WHERE channel_id = _channel_id), 0)
  + COALESCE((SELECT COUNT(*) FROM public.channel_bgm_items WHERE channel_id = _channel_id), 0)
  + COALESCE((SELECT COUNT(*) FROM public.channel_allowed_projects WHERE channel_id = _channel_id), 0)
  + COALESCE((SELECT COUNT(*) FROM public.channel_blocks WHERE channel_id = _channel_id), 0)
  + COALESCE((SELECT COUNT(*) FROM public.screen_channel_switch_triggers WHERE target_channel_id = _channel_id), 0)
$$;

-- Trigger: on changes to referencing tables, attempt to execute pending channel deletes
CREATE OR REPLACE FUNCTION public.try_execute_pending_channel_deletes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_id uuid;
BEGIN
  -- Determine which channel id to inspect from OLD or NEW
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'screen_channel_switch_triggers' THEN
      v_channel_id := OLD.target_channel_id;
    ELSE
      v_channel_id := OLD.channel_id;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'screen_channel_switch_triggers' THEN
      v_channel_id := NEW.target_channel_id;
    ELSE
      v_channel_id := NEW.channel_id;
    END IF;
  END IF;

  IF v_channel_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- If a pending delete exists and refs are zero, execute it
  IF EXISTS (
    SELECT 1 FROM public.channel_delete_requests
    WHERE channel_id = v_channel_id AND status = 'pending'
  ) AND public.count_channel_references(v_channel_id) = 0 THEN
    DELETE FROM public.channels WHERE id = v_channel_id;
    UPDATE public.channel_delete_requests
      SET status = 'executed', executed_at = now(), updated_at = now()
    WHERE channel_id = v_channel_id AND status = 'pending';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_cdr_subs
  AFTER DELETE ON public.screen_channel_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_channel_deletes();

CREATE TRIGGER trg_cdr_bgm
  AFTER DELETE ON public.channel_bgm_items
  FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_channel_deletes();

CREATE TRIGGER trg_cdr_allowed
  AFTER DELETE ON public.channel_allowed_projects
  FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_channel_deletes();

CREATE TRIGGER trg_cdr_blocks
  AFTER DELETE ON public.channel_blocks
  FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_channel_deletes();

CREATE TRIGGER trg_cdr_triggers
  AFTER DELETE ON public.screen_channel_switch_triggers
  FOR EACH ROW EXECUTE FUNCTION public.try_execute_pending_channel_deletes();

CREATE TRIGGER update_channel_delete_requests_updated_at
  BEFORE UPDATE ON public.channel_delete_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();