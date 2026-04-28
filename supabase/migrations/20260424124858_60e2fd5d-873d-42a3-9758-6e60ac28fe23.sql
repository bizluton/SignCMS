-- Extend cleanup settings table with media cleanup fields
ALTER TABLE public.schedule_cleanup_settings
  ADD COLUMN IF NOT EXISTS media_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_retention_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS media_last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS media_last_deleted_count integer NOT NULL DEFAULT 0;

-- Helper: returns set of design_project ids that are currently "in use"
-- (referenced by channels/screens/triggers, so the media inside their zones is in use).
CREATE OR REPLACE FUNCTION public._active_design_project_ids()
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id
  FROM public.design_projects p
  WHERE
       EXISTS (SELECT 1 FROM public.channels c WHERE c.default_design_project_id = p.id)
    OR EXISTS (SELECT 1 FROM public.channel_allowed_projects cap WHERE cap.design_project_id = p.id)
    OR EXISTS (SELECT 1 FROM public.channel_blocks cb WHERE cb.design_project_id = p.id)
    OR EXISTS (SELECT 1 FROM public.smart_trigger_rules str WHERE str.target_design_project_id = p.id);
$$;

-- Core media cleanup function
CREATE OR REPLACE FUNCTION public.auto_delete_unused_media()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_retention integer;
  v_cutoff timestamptz;
  v_deleted integer := 0;
  v_used_media_ids uuid[];
BEGIN
  SELECT media_enabled, COALESCE(media_retention_days, 90)
    INTO v_enabled, v_retention
  FROM public.schedule_cleanup_settings
  WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN 0;
  END IF;

  IF v_retention < 1 THEN v_retention := 1; END IF;
  v_cutoff := now() - make_interval(days => v_retention);

  -- Build the set of media ids currently referenced anywhere:
  -- 1. Bound to an active design project via media_items.design_project_id
  -- 2. In channel BGM playlists
  -- 3. Inside design_projects.zones JSON of any active project
  --    (zones[*].content.mediaItems[*].id, zones[*].overlays[*].content.mediaItems[*].id,
  --     zones[*].bgm.items[*].id)
  WITH active_projects AS (
    SELECT id FROM public._active_design_project_ids()
  ),
  zone_media AS (
    SELECT (mi->>'id')::uuid AS media_id
    FROM public.design_projects p
    JOIN active_projects ap ON ap.id = p.id,
         LATERAL jsonb_array_elements(COALESCE(p.zones, '[]'::jsonb)) AS z,
         LATERAL jsonb_array_elements(COALESCE(z->'content'->'mediaItems', '[]'::jsonb)) AS mi
    WHERE jsonb_typeof(p.zones) = 'array'
      AND (mi->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  overlay_media AS (
    SELECT (mi->>'id')::uuid AS media_id
    FROM public.design_projects p
    JOIN active_projects ap ON ap.id = p.id,
         LATERAL jsonb_array_elements(COALESCE(p.zones, '[]'::jsonb)) AS z,
         LATERAL jsonb_array_elements(COALESCE(z->'overlays', '[]'::jsonb)) AS ov,
         LATERAL jsonb_array_elements(COALESCE(ov->'content'->'mediaItems', '[]'::jsonb)) AS mi
    WHERE jsonb_typeof(p.zones) = 'array'
      AND (mi->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  bgm_zone_media AS (
    SELECT (a->>'id')::uuid AS media_id
    FROM public.design_projects p
    JOIN active_projects ap ON ap.id = p.id,
         LATERAL jsonb_array_elements(COALESCE(p.zones, '[]'::jsonb)) AS z,
         LATERAL jsonb_array_elements(COALESCE(z->'bgm'->'items', '[]'::jsonb)) AS a
    WHERE jsonb_typeof(p.zones) = 'array'
      AND (a->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  bound_media AS (
    SELECT m.id AS media_id
    FROM public.media_items m
    JOIN active_projects ap ON ap.id = m.design_project_id
  ),
  bgm_items AS (
    SELECT cbi.media_id FROM public.channel_bgm_items cbi
  )
  SELECT array_agg(DISTINCT media_id)
    INTO v_used_media_ids
  FROM (
    SELECT media_id FROM zone_media
    UNION ALL SELECT media_id FROM overlay_media
    UNION ALL SELECT media_id FROM bgm_zone_media
    UNION ALL SELECT media_id FROM bound_media
    UNION ALL SELECT media_id FROM bgm_items
  ) u
  WHERE media_id IS NOT NULL;

  IF v_used_media_ids IS NULL THEN
    v_used_media_ids := ARRAY[]::uuid[];
  END IF;

  -- Delete unused image/video media older than cutoff. Skip system media.
  WITH del AS (
    DELETE FROM public.media_items m
    WHERE m.is_system = false
      AND m.type IN ('image', 'video')
      AND m.created_at < v_cutoff
      AND NOT (m.id = ANY (v_used_media_ids))
    RETURNING m.id
  )
  SELECT count(*) INTO v_deleted FROM del;

  -- Persist last-run stats
  UPDATE public.schedule_cleanup_settings
     SET media_last_run_at = now(),
         media_last_deleted_count = v_deleted,
         updated_at = now()
   WHERE id = 1;

  -- Audit log
  INSERT INTO public.activity_logs (user_id, category, action, action_code, action_params, target_type, detail)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    'system',
    'media_cleanup_run',
    'system.media_cleanup_run',
    jsonb_build_object('deleted', v_deleted, 'retention_days', v_retention),
    'media',
    'Auto media cleanup deleted ' || v_deleted || ' unused media item(s)'
  );

  RETURN v_deleted;
END;
$$;

-- Update settings RPC to accept media fields
CREATE OR REPLACE FUNCTION public.update_schedule_cleanup_settings(
  _retention_days integer,
  _enabled boolean,
  _media_retention_days integer DEFAULT NULL,
  _media_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_system_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF _retention_days < 1 OR _retention_days > 3650 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_retention_days');
  END IF;

  IF _media_retention_days IS NOT NULL AND (_media_retention_days < 1 OR _media_retention_days > 3650) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_media_retention_days');
  END IF;

  UPDATE public.schedule_cleanup_settings
     SET retention_days = _retention_days,
         enabled = _enabled,
         media_retention_days = COALESCE(_media_retention_days, media_retention_days),
         media_enabled = COALESCE(_media_enabled, media_enabled),
         updated_at = now(),
         last_run_by = auth.uid()
   WHERE id = 1;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Manual run RPC for media cleanup
CREATE OR REPLACE FUNCTION public.run_media_cleanup_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
  v_was_enabled boolean;
BEGIN
  IF NOT public.is_system_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- Temporarily force enabled so manual runs always execute
  SELECT media_enabled INTO v_was_enabled FROM public.schedule_cleanup_settings WHERE id = 1;
  UPDATE public.schedule_cleanup_settings SET media_enabled = true WHERE id = 1;

  v_deleted := public.auto_delete_unused_media();

  -- Restore prior enabled value if it was off
  IF NOT COALESCE(v_was_enabled, false) THEN
    UPDATE public.schedule_cleanup_settings SET media_enabled = false WHERE id = 1;
  END IF;

  RETURN jsonb_build_object('success', true, 'deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_media_cleanup_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_schedule_cleanup_settings(integer, boolean, integer, boolean) TO authenticated;

-- Reschedule the daily cron job to also run media cleanup
DO $$
BEGIN
  PERFORM cron.unschedule('auto-delete-old-expired-blocks');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('schedule-and-media-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'schedule-and-media-cleanup',
  '15 3 * * *',
  $cron$
    SELECT public.auto_delete_old_expired_channel_blocks();
    SELECT public.auto_delete_unused_media();
  $cron$
);